# Metric LP Guide

**Metric LP指南：看懂 Bin，规划配币，比较 LP 收益情景。**

一个在自己电脑上运行的 Metric 池子监控与学习工具。读取公开市场数据，解释参考价与 Bin，估算配币比例、分时段 Edge 收入，以及涨跌后的持币对比。

**作者 / Author:** [@BuTongRen6](https://x.com/BuTongRen6)  
**Metric 邀请链接 / Referral:** [app.metric.xyz/r/butongren](https://app.metric.xyz/r/butongren)  
**邀请码 / Code:** `butongren`

## 快速开始

需要 **Python 3.9 或以上**，无需安装第三方 Python 包或 Node.js。需要网络才能读取最新行情。

1. 下载 [Metric-LP-Guide-v1.0.0.zip](https://github.com/butongren/Metric-LP-Guide/raw/refs/heads/main/downloads/Metric-LP-Guide-v1.0.0.zip)，或点击仓库的 **Code → Download ZIP** 下载全部源码。
2. **先解压**到自己的文件夹。
3. Windows 双击 **启动工具.cmd**。macOS / Linux 在该文件夹运行 `python3 start.py`。
4. 浏览器会打开 **http://127.0.0.1:8767/**。

不要直接双击 `index.html`，页面需要本机 Python 数据服务。此项目不是纯静态网站，不能直接用 GitHub Pages 运行完整功能。

如果 Windows 提示找不到 Python，请从 [Python 官网](https://www.python.org/downloads/) 安装，勾选安装程序的 **Add Python to PATH**，然后重新打开启动文件。

## 功能

- **市场监控**：TVL、成交量、Edge APR、Trading P&L APR、公开网络与池子筛选；默认每 30 秒刷新，后台标签页暂停轮询。
- **Bin 入门**：编号与偏离区间说明、活跃位置示意、参考价变化的互动演示。
- **配币测算**：按当前 Bin 储备比例估算两币数量；支持等额或储备权重分配、单币起始的配齐估算。
- **收益情景**：10 / 30 分钟，1 / 4 / 8 / 12 / 24 小时，15 / 30 天的固定 APR 单利估算。
- **涨跌对比**：分别假设币价与兑换过程，比较 LP 仓位、原配比持币和本金盈亏。
- **方案保存**：当前浏览器本地保存，支持 CSV 导出。

完整步骤、公式与常见问题见 [使用说明](使用说明.md)。

## 理解结果

Bin 是相对池子参考价的区间，不是固定美元价格范围。单纯参考价变化不会自动换币；交易使用你的流动性时，才会改变代币数量并产生 Edge。

**Trading P&L 已包含 Edge**，衡量相对持币的盈亏，不能与 Edge 相加，也不是相对本金的净收益。本工具的涨跌测算是手动情景，不读取个人钱包成本。

APR 是历史数据，情景结果不是收益承诺；API 快照配比不是链上入池报价。区间提示会标明历史或缺失数据，不保证你实际仓位当前活跃。

## 隐私与运行方式

- 服务只绑定 `127.0.0.1`，不对局域网开放。
- 不需要账户、钱包、私钥、助记词或 API Key；不签名、不发送交易。
- 资金输入与保存方案在当前浏览器处理；服务读取 Metric 官方公开接口。
- 启动后会生成 `data/` 缓存和日志；这些运行文件不包含在发布包中，并已加入 `.gitignore`。
- 作者推特、邀请链接与邀请码是有意公开的项目信息。

更多说明见 [隐私与发布说明](PRIVACY.md)。

## 运行与退出

重复启动会复用已有的本机 Metric 服务。关闭页面或启动窗口不会停止后台服务，电脑重启后需要重新启动工具。

需要前台运行并方便退出时，进入文件夹运行 `python metric_server.py`（macOS / Linux 用 `python3`），用 `Ctrl+C` 停止。若 8767 端口已被旧版本占用，请先关闭已确认的旧服务；不要随意结束其他 Python 程序。

初次使用没有缓存时，需要等公开接口返回。网络失败后有缓存会显示上次成功数据及提示；没有缓存时显示等待数据。详细排查见使用说明。

## English

**Metric LP Guide** is a local dashboard and learning tool for Metric liquidity pools. It explains reference-relative bins, estimates token allocation from reserve snapshots, projects Edge income under fixed-APR assumptions, and compares manual trading scenarios with holding the original tokens.

Requires Python 3.9+ and a browser. No third-party Python packages are required. Extract the project, run `python start.py` (or `python3 start.py`), then open `http://127.0.0.1:8767/`. On Windows, you can double-click `启动工具.cmd`.

It uses public Metric APIs, does not connect to wallets or send transactions, and stores saved scenarios in your browser. APR is historical, not a forecast. Trading P&L includes Edge and compares against holding, not against the original dollar deposit. Bin status describes the selected simulation range, not a personal wallet position.

This is an independent project, not an official Metric product. The app includes the author's referral link shown above.

## 数据与机制来源

- [Metric：Liquidity and bins](https://docs.metric.xyz/how-pools-work/liquidity-and-bins)
- [Metric：Provide and manage liquidity](https://docs.metric.xyz/use-metric/provide-and-manage-liquidity)
- [Metric：Understanding your returns](https://docs.metric.xyz/use-metric/provide-and-manage-liquidity/understanding-your-returns)
- [Metric：Metadata API](https://docs.metric.xyz/reference/api/metadata)

本项目独立维护，非 Metric 官方产品。公开源码不自动代表采用某个开源许可证；本版本尚未指定许可证。
