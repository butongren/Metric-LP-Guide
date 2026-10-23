"""Metric public monitor: standard library, localhost, read-only public APIs."""
import concurrent.futures as futures
import copy
import json
import math
import os
import re
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode

ROOT = Path(__file__).resolve().parent
API = 'https://api.metric.xyz/public/v1/'
PORT = int(os.environ.get('METRIC_LOCAL_PORT', '8767'))
APP_ID = 'metric-local-planner'
VERSION = 3


def obj(value):
    return value if isinstance(value, dict) else {}


def num(value, nonnegative=False):
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        return None
    if not math.isfinite(value) or (nonnegative and value < 0):
        return None
    return value


def units(value, decimals):
    if not isinstance(value, str) or not re.fullmatch(r'\d{1,90}', value):
        return None
    if type(decimals) is not int or not 0 <= decimals <= 36:
        return None
    return int(value) / 10**decimals


def get_json(path):
    req = urllib.request.Request(API + path, headers={
        'User-Agent': 'Mozilla/5.0 MetricLocalPlanner/1.0',
        'Accept': 'application/json', 'Origin': 'https://app.metric.xyz'})
    with urllib.request.urlopen(req, timeout=20) as response:
        data = response.read(8_000_001)
    if len(data) > 8_000_000:
        raise ValueError('接口响应超过限制')
    return json.loads(data)


class Cache:
    def __init__(self, path=None):
        self.path = path or ROOT/'data'/'metric-cache-v1.json'
        self.lock = threading.RLock()
        self.keylocks = {}
        self.values = {}
        try:
            raw = obj(json.loads(self.path.read_text('utf-8')))
            self.values = {k: v for k, v in raw.items() if isinstance(v, dict)
                           and num(v.get('fetchedAt'), True) is not None
                           and num(v.get('attemptedAt'), True) is not None and 'value' in v}
        except (OSError, ValueError):
            pass

    def snapshot(self, key, ttl=30):
        with self.lock:
            result = copy.deepcopy(self.values.get(key, {
                'value': None, 'fetchedAt': 0, 'attemptedAt': 0, 'error': '尚无 Metric 缓存，等待联网读取'}))
        result['stale'] = bool(result.get('error')) or time.time()-result['fetchedAt'] > ttl*2
        return result

    def get(self, key, loader, ttl=30):
        with self.lock:
            lock = self.keylocks.setdefault(key, threading.Lock())
        with lock:
            with self.lock:
                old = copy.deepcopy(self.values.get(key))
            if old and time.time()-old['attemptedAt'] < (min(ttl, 15) if old.get('error') else ttl):
                return self.snapshot(key, ttl)
            try:
                value = loader()
                result = {'value': value, 'fetchedAt': time.time(), 'attemptedAt': time.time(), 'error': None}
            except Exception as exc:
                result = dict(old or {'value': None, 'fetchedAt': 0})
                result.update(attemptedAt=time.time(), error=type(exc).__name__+': '+str(exc)[:220])
            with self.lock:
                self.values[key] = result
                try:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = self.path.with_suffix('.tmp')
                    tmp.write_text(json.dumps(self.values, ensure_ascii=False, allow_nan=False), 'utf-8')
                    tmp.replace(self.path)
                except (OSError, ValueError):
                    pass
            return self.snapshot(key, ttl)


CACHE = Cache()


def load_chains():
    rows = obj(get_json('chains')).get('chains')
    if not isinstance(rows, list) or not rows:
        raise ValueError('Metric 网络列表格式变化')
    result = []
    for row in rows:
        row = obj(row)
        if row.get('type') == 'evm' and type(row.get('chainId')) is int and row['chainId'] > 0 and isinstance(row.get('name'), str):
            result.append({'chainId': row['chainId'], 'name': row['name']})
    if not result:
        raise ValueError('Metric 暂未返回有效网络')
    return result


def load_metadata():
    rows, offset, visited = [], 0, set()
    for _ in range(40):
        if offset in visited:
            raise ValueError('Metric 分页重复，保留上次完整结果')
        visited.add(offset)
        params = {'include24h': 'true', 'count': 500, 'offset': offset,
                  'sortBy': 'tvl', 'sortOrder': 'desc', 'minTvlFiat': 10}
        page = obj(get_json('evm/metadata?'+urlencode(params)))
        if not isinstance(page.get('data'), list) or type(page.get('total')) is not int or 'nextOffset' not in page:
            raise ValueError('Metric 池子分页格式变化')
        rows.extend(page['data'])
        next_offset = page['nextOffset']
        if next_offset is None:
            return rows
        if type(next_offset) is not int or next_offset <= offset or not page['data']:
            raise ValueError('Metric 分页无效，保留上次完整结果')
        offset = next_offset
    raise ValueError('池子数量超过完整读取限制')


def normalize_pool(row, chain_map):
    row = obj(row)
    chain = chain_map.get(str(row.get('chain', '')).lower())
    address = row.get('poolAddress')
    if chain is None or not isinstance(address, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', address):
        return None
    a = obj(row.get('analytics24h'))
    tokens = []
    for key in ('token0', 'token1'):
        addr = row.get(key)
        if not isinstance(addr, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', addr):
            return None
        decimals = row.get(key+'Decimals')
        tokens.append({'address': addr, 'symbol': row.get(key+'Symbol') or addr[:8],
                       'decimals': decimals if type(decimals) is int and 0 <= decimals <= 36 else None,
                       'usd': num(row.get(key+'FiatPrice'), True),
                       'reserve': units(obj(a.get(key)).get('liquidityRaw'), decimals)})
    def apr(v):
        n = num(v)
        return n/100 if n is not None else None
    return {'id': str(chain['chainId'])+':'+address.lower(), 'address': address,
            'chainId': chain['chainId'], 'chain': chain['name'], 'version': row.get('contractVersion'),
            'base': tokens[0], 'quote': tokens[1], 'tvl': num(row.get('tvlFiat'), True),
            'volume24h': num(a.get('volumeFiat'), True), 'edge24h': num(a.get('feesFiat')),
            'apr7d': apr(row.get('aprBps7d')), 'apr24h': apr(a.get('aprBps')),
            'tradingApr7d': apr(row.get('tradingPnlAprBps7d')),
            'tier': obj(row.get('classificationSummary')).get('tierQualification', 'unclassified'),
            'curator': row.get('adminUsername') or row.get('admin') or '未提供',
            'verified': row.get('verifiedAdmin') is True,
            'pauseLevel': row.get('pauseLevel'), 'priceStatus': row.get('priceProviderStatus', 'unknown'),
            'allowlist': row.get('depositWhitelistingEnabled'), 'lockedPricing': row.get('lockedPricing'),
            'activeBin': row.get('curBinIdx'), 'dataAt': num(a.get('generatedAtTs'), True),
            'coverage': num(a.get('fiatCoveragePct'), True),
            'protocolShare': row['spreadProtocolFeeE6']/10000 if num(row.get('spreadProtocolFeeE6')) is not None else None,
            'curatorShare': row['spreadAdminFeeE6']/10000 if num(row.get('spreadAdminFeeE6')) is not None else None,
            'url': 'https://app.metric.xyz/pool/'+str(chain['chainId'])+'/'+address}


def market(cached=False):
    with futures.ThreadPoolExecutor(max_workers=2) as ex:
        ch = ex.submit(CACHE.snapshot, 'chains', 3600) if cached else ex.submit(CACHE.get, 'chains', load_chains, 3600)
        md = ex.submit(CACHE.snapshot, 'metadata') if cached else ex.submit(CACHE.get, 'metadata', load_metadata)
        chains, metadata = ch.result(), md.result()
    chain_rows = chains['value'] if isinstance(chains['value'], list) else []
    raw = metadata['value'] if isinstance(metadata['value'], list) else []
    mapping = {str(c['name']).lower(): c for c in chain_rows}
    pools, seen, invalid = [], set(), 0
    for row in raw:
        p = normalize_pool(row, mapping)
        if not p:
            invalid += 1
        elif p['id'] not in seen:
            pools.append(p)
            seen.add(p['id'])
    sources = {k: {x: v.get(x) for x in ('fetchedAt', 'stale', 'error')} for k, v in [('chains', chains), ('metadata', metadata)]}
    return {'platform': 'metric', 'pools': pools, 'chains': chain_rows, 'sources': sources,
            'invalidRows': invalid, 'servedAt': time.time(), 'minTvl': 10}


def normalize_bins(raw, pool):
    raw = obj(raw)
    if not isinstance(raw.get('bins'), list):
        raise ValueError('Metric Bin 接口格式变化')
    if str(raw.get('pair', '')).lower() != pool['address'].lower() or str(raw.get('chain', '')).lower() != pool['chain'].lower():
        raise ValueError('Bin 返回了不同池子或网络')
    bins, indices = [], set()
    for row in raw['bins']:
        row = obj(row)
        try:
            idx = int(row.get('bin'))
        except (ValueError, TypeError):
            raise ValueError('Bin 编号无效')
        if str(idx) != str(row.get('bin')) or not -32768 <= idx <= 32767 or idx in indices:
            raise ValueError('Bin 编号重复或越界')
        indices.add(idx)
        b0, b1 = obj(row.get('token0')), obj(row.get('token1'))
        bins.append({'index': idx, 'base': units(b0.get('reserveRaw'), pool['base']['decimals']),
                     'quote': units(b1.get('reserveRaw'), pool['quote']['decimals']),
                     'width': num(row.get('lengthE6'), True),
                     'apr24h': num(row.get('aprBps'))/100 if num(row.get('aprBps')) is not None else None,
                     'pnlApr24h': num(row.get('pnlAprBps'))/100 if num(row.get('pnlAprBps')) is not None else None,
                     'swapCount': row.get('swapCount'), 'baseline': row.get('hasBaseline') is True})
    bins.sort(key=lambda b: b['index'])
    by_index = {b['index']: b for b in bins}
    # Bin 0 begins at zero deviation. Missing widths must not invent boundaries.
    for direction in (1, -1):
        i, boundary = (0, 0.0) if direction == 1 else (-1, 0.0)
        while i in by_index:
            b = by_index[i]
            if b['width'] is None or b['width'] <= 0:
                break
            width = b['width']/10000
            b['lowerDeviation'] = boundary if direction == 1 else boundary-width
            b['upperDeviation'] = boundary+width if direction == 1 else boundary
            boundary += direction*width
            i += direction
    return {'bins': bins, 'activeBin': raw.get('curBinIdx'),
            'fromTs': num(obj(raw.get('window')).get('fromTs'), True),
            'toTs': num(obj(raw.get('window')).get('toTs'), True), 'period': raw.get('period')}


def bin_state(key, cached=False):
    if not re.fullmatch(r'[1-9]\d{0,9}:0x[0-9a-f]{40}', key):
        raise ValueError('无效池子编号')
    pool = next((p for p in market(cached=True)['pools'] if p['id'] == key), None)
    if not pool:
        raise ValueError('请先刷新市场并选择已列出的池子')
    def load():
        params = {'period': '24h', 'fiat': 'USD'}
        if pool.get('version'):
            params['contract_version'] = pool['version']
        path = 'evm/'+str(pool['chainId'])+'/'+pool['address']+'/analytics/bins?'+urlencode(params)
        return normalize_bins(get_json(path), pool)
    return CACHE.snapshot('bins:'+key) if cached else CACHE.get('bins:'+key, load)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
            self.send_error(403)
            return
        if self.headers.get('Origin') not in (None, f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
            self.send_error(403)
            return
        parsed, status = urlparse(self.path), 200
        query = parse_qs(parsed.query)
        try:
            if parsed.path == '/api/health':
                data = {'app': APP_ID, 'version': VERSION, 'status': 'ok'}
            elif parsed.path == '/api/markets':
                data = market(query.get('cached') == ['1'])
            elif parsed.path == '/api/bins':
                data = bin_state(query.get('pool', [''])[0], query.get('cached') == ['1'])
            elif parsed.path in ('/', '/index.html', '/app.js', '/math.js', '/style.css'):
                name = parsed.path[1:] or 'index.html'
                mime = 'text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html'
                self.reply((ROOT/name).read_bytes(), mime)
                return
            else:
                self.send_error(404)
                return
        except ValueError as exc:
            data, status = {'error': str(exc)}, 400
        except Exception:
            data, status = {'error': '本机处理失败，请刷新重试。'}, 502
        self.reply(json.dumps(data, ensure_ascii=False, allow_nan=False).encode(), 'application/json', status)

    def reply(self, data, mime, status=200):
        self.send_response(status)
        for key, value in {'Content-Type': mime+'; charset=utf-8', 'Content-Length': str(len(data)),
                           'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                           'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"}.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


if __name__ == '__main__':
    print(f'Metric LP monitor: http://127.0.0.1:{PORT}', flush=True)
    LocalServer(('127.0.0.1', PORT), Handler).serve_forever()
