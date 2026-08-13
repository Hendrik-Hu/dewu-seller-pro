# Seller Inventory App 竞品与产品模式研究（第一轮）

> 研究日期：2026-08-11
>
> 研究阶段：Discovery / 研究优先，尚未进入方案设计
>
> 当前产品基线：`v0.21.0`；`codex/v0.22.0-mobile-ux-system` 仅作为未发布视觉草稿保留
>
> 本文目的：沉淀可复用的产品认知，不用于证明任何竞品已经真实实现其营销页所描述的全部能力。

## 1. 研究问题

本轮不回答“下一版应该画成什么样”，先回答五个更基础的问题：

1. 个人潮鞋卖家每天真正需要完成哪些工作，而不只是查看哪些数据？
2. 商品、尺码、单件库存、仓库、订单和资金应当如何分层？
3. 扫鞋盒标签、扫条码和商品库匹配分别解决什么问题，失败时如何回退？
4. 一次“卖出”在得物类平台上何时才真正完成？
5. 当前 App 是可靠库存账本、轻量卖家工具，还是完整卖家操作系统？

## 2. 证据规则

| 等级 | 证据类型 | 可以支持的结论 | 不可以支持的结论 |
|---|---|---|---|
| A | 官方帮助中心、开发文档、规则、技术文章 | 产品或平台公开定义的流程、状态和接口能力 | 实际易用性、稳定性和用户满意度 |
| B | 官方产品页、应用商店产品描述 | 厂商公开宣称的定位和功能 | 功能已被独立验证、数据准确、用户规模真实 |
| C | 应用商店公开评价 | 个别用户的真实使用感受和痛点线索 | 全体用户共识、因果关系 |
| D | 基于多项证据的产品推断 | 形成待验证假设 | 直接作为需求或数据库方案落地 |

本文所有竞品功能默认按其官方公开信息记录。没有实际注册、付费和完成完整任务测试的产品，不写成“已验证”。

## 3. 竞品分层

### 3.1 直接竞品：球鞋转售库存与利润工具

这类产品通常从 Excel 替代切入，核心承诺是“每双鞋都找得到、卖出后知道赚多少”。

| 产品 | 官方定位与关键能力 | 产品模式 | 证据与限制 |
|---|---|---|---|
| [FootVault](https://www.footvault.dev/) | 按 SKU、尺码、成色、状态管理；商品搜索自动补全；变体 QR 标签；销售、客户与真实利润 | 轻量库存 + 销售 | B。功能来自官方营销页，未做完整实机验证 |
| [PairFlow](https://pairflow.co/) | 库存、销售、订单、利润、目标、通知、CSV 导入；订单从 sold 到 delivered | 转售运营工作台 | B。页面强调安静、聚焦的工作区，但当前成熟度需进一步验证 |
| [Synkei](https://www.synkei.com/en/index.html) | 父商品/变体；SKU、条码、EU 尺码、买卖价；订单变体选择器、实时库存、角色权限、Shopify 同步 | 店铺库存与订单系统 | B。数据模型描述较完整，仍需登录后任务测试 |
| [Revnu](https://www.revnu.net/) | 订单、支付匹配、运单、条码、库存、多平台同步、财务面板 | 多平台卖家运营系统 | B。集成能力来自厂商宣称，未核验每个平台真实可用范围 |
| [Sire](https://home.sireapp.io/) | UPC 扫描、仓库位置、客户报价、议价、支付、运单和短信通知 | 销售协作 + 履约 | B。流程表达清楚；Shopify 商店页公开评价仍很少，不能据此判断成熟度 |
| [SoleInventory](https://soleinventory.co.uk/) | 库存、销售、平台费用与利润 | 轻量账本 | B。适合作为“最小可用记录器”参照，不是复杂运营标杆 |

**第一项发现（D）：** 直接竞品至少分为三种，不应放在同一张功能清单里比较：

- 轻量记录器：核心是库存、成本、费用和利润。
- 运营系统：核心是订单、客户、履约、支付和多平台协同。
- 数据/识别工具：核心是快速识别、行情比较和买入决策。

### 3.2 相邻竞品：通用转售卖家工具

| 产品 | 值得研究的能力 | 研究价值 | 证据与限制 |
|---|---|---|---|
| [Resylr](https://www.resylr.com/reseller-inventory-labels/) | 单件记录连接照片、成色、成本、平台刊登、库位、订单拣货、利润和税务记录 | 说明“标签本身不是系统，标签必须指向完整物品记录” | B |
| [Stockist](https://getstockist.co.uk/) | 条码自动补全、离线 PWA、批量入库会话、来源复用、成本确认、QR 标签 | 适合研究高频现场入库如何减少重复输入 | B，产品仍偏早期 |
| [Flippd](https://apps.apple.com/us/app/flippd-reseller-inventory/id1633899291) | 成本、费用、运费、利润、收据 OCR、里程、库位、批量采购 | 将库存和完整经营成本放在同一条利润链 | B + C；App Store 4.6/107 只能作为成熟度线索 |
| [Rivet](https://play.google.com/store/apps/details?id=com.rivets.inventory) | 条码/QR/图片识别、库位、成色、照片、COGS、平台费、运费和包装费 | 研究移动端扫描与“真实净利润”的组合 | B，公开上线时间较短 |
| [SellerBook 2](https://play.google.com/store/apps/details?id=com.sellerbook2.production) | 截图导入、对话记销售、Pre-listing/List/待付款/待发货/待评价/完成 | AI 不是独立聊天页，而是进入结构化业务状态 | B |

### 3.3 成熟库存与零售系统：数据模型标杆

这些产品不是直接市场竞争者，但比早期转售工具更适合用来验证库存语义。

| 产品 | 已公开的成熟模式 | 对本项目的研究意义 |
|---|---|---|
| [Shopify Inventory](https://help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states) | `On hand = Available + Committed + Unavailable`，另有 `Incoming`；按变体和地点查看；支持全部地点汇总 | 库存不能只有一个 stock 和一个粗状态；“手上有”不等于“可出售” |
| [Shopify Variants](https://help.shopify.com/en/manual/products/variants/searching-filtering) | 父商品下管理变体；可按选项和地点筛选；`All locations` 查看总可售量 | 商品身份、尺码变体和仓库数量应分层 |
| [Zoho Inventory](https://www.zoho.com/us/inventory/help/items/items-overview.html) | 父商品/变体、仓库、库位、序列号/批次、FIFO/WAC、退货资格、补货点 | 成本口径不是界面计算细节，而是库存核算策略 |
| [Square Inventory](https://squareup.com/help/us/en/topic/items-and-inventory) | 接收、调整、盘点、调拨、采购订单、供应商、成本缺失检查、变体、GTIN、条码标签 | “收货”“改数”“调拨”“退货”应是不同事件并保留原因 |
| [Square Transfer Orders](https://squareup.com/help/us/en/article/8300-create-transfer-orders-with-square-for-retail) | 调拨有草稿、来源、目标、预计时间、跟踪号、部分收货和历史 | 跨仓移动不是简单把 warehouse 字段改掉 |

### 3.4 平台竞品：得物、StockX、eBay 的交易语义

平台本身不是库存工具竞品，但它们定义了卖家的真实工作流。

#### 得物

- 得物个人卖家官方入口公开了预售、现货、求购等多种交易模式，并明确“鉴别通过立即结算”：[个人卖家入口](https://dewu.com/personal-enter.html)。
- 企业商家拥有 ERP 接口等能力，而个人卖家不具备同等开放能力：[企业商家入口](https://dewu.com/store)。
- 得物技术文章将新品、商品、草稿分离，并给商品设置上架、下架、待补全、待审核等状态：[商品状态体系](https://tech.dewu.com/article?id=91)。

**推断（D）：** 对个人卖家而言，“在 App 中点了卖出”不等于交易完成。至少还存在待发货、平台收货、鉴别、鉴别失败、结算和退回等节点。

#### StockX

- 标准卖出后需要在时限内发货：[卖家发货流程](https://stockx.com/help/articles/how-does-shipping-on-stockx-work-for-sellers)。
- 新品通常在通过鉴定后才具备结算资格：[卖家结算](https://stockx.com/help/articles/As-a-Seller-how-and-when-do-I-get-paid)。
- 鉴定失败可能导致退回并产生卖家成本：[鉴定流程](https://stockx.com/help/articles/what-does-the-verification-process-entail-for-sellers/P2Kc5EaiSY-osU1ZWF6joA)。

#### eBay

- 卖出后存在待发货、已发货、物流跟踪和未收到货争议：[物流跟踪](https://www.ebay.com/help/selling/shipping-items/tracking-items-youve-sold?id=4088)。
- 退货、缺失、取消、退款和资金冻结都有独立流程：[退货与退款](https://www.ebay.com/help/selling/managing-returns-refunds/manage-returns-missing-items-refunds-sellers?id=4079)。

**第二项发现（D）：** 成熟平台把库存、订单、履约、鉴别和资金结算分开。只保存一条“出库流水”会丢失平台交易中最容易出错、最需要提醒和最影响利润的部分。

## 4. 商品识别与商品库研究

### 4.1 OCR、条码、二维码不是同一个能力

| 输入方式 | 实际得到什么 | 可以直接完成什么 | 仍然缺少什么 |
|---|---|---|---|
| 扫品牌鞋盒条码 | UPC/EAN/Code 128 等原始编码 | 快速获取候选标识 | 编码到商品/尺码的可信映射 |
| OCR 鞋盒侧标 | 货号、尺码、颜色、名称片段、价格等候选文本 | 在没有可用条码映射时提取字段 | 字段定位、品牌规则、置信度、冲突处理 |
| 扫我们自己生成的 QR | 我们数据库中的 item/variant/unit ID | 精确打开已有库存记录 | 只能识别已经入库并贴过标签的商品 |
| 图片相似搜索 | 商品候选集合 | 辅助查找款式 | 同款不同配色/年份/尺码易混淆，不能直接写库存 |

技术可行性证据：

- Google [ML Kit Barcode Scanning](https://developers.google.com/ml-kit/vision/barcode-scanning/android) 可离线识别 Code 128/39/93、EAN、UPC、QR、PDF417、Aztec、Data Matrix 等常见格式。
- Google [ML Kit Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2) 支持中文和拉丁文字，并返回文本结构、位置和置信度。
- [SneakScan](https://sneakscan.com/) 的公开流程是扫描完整鞋盒标签，用 OCR 找 SKU，再去 StockX、GOAT、eBay 查询；它没有把 OCR 结果直接当成最终商品。
- [eBay Browse API](https://developer.ebay.com/api-docs/buy/api-browse.html) 支持关键词、GTIN、产品 ID 和图片查询，但返回的是平台商品/刊登候选，不是我们的权威商品主数据。

### 4.2 成熟识别链应当研究的六个阶段

```text
采集图像/条码
  -> 提取候选字段
  -> 规范化品牌、货号、尺码和编码
  -> 多来源召回商品候选
  -> 排序并显示匹配证据/置信度
  -> 用户确认后才创建或绑定库存
```

这说明“做 OCR”与“建设商品库”不是二选一：OCR 是输入渠道，商品库是匹配和复用基础，确认环节是数据质量防线。

### 4.3 商品库最少需要回答的问题（尚未形成方案）

- 同一款商品的权威主键是什么：品牌 + 厂商货号，还是平台 SPU？
- 一个货号是否可能跨地区、年份或配色复用？
- UPC/EAN 是对应整款、尺码变体，还是包装批次？
- 尺码如何保存原始体系（US/EU/UK/CM）并避免错误换算？
- 商品名称、主图和颜色来自哪里，许可证是否允许长期存储和展示？
- 多来源冲突时谁是权威：用户历史、品牌标签、平台目录，还是人工维护？
- 新商品如何进入库：自动创建、候选草稿、人工审核，还是用户私有记录？
- 错误映射如何撤销，并避免污染所有用户？

## 5. 横向产品模式库

### 5.1 模式一：父商品、变体、实物/批次、仓库数量分层

成熟系统常见层级是：

```text
商品主数据（品牌、货号、名称、配色、主图）
  -> 变体（尺码体系、尺码、条码）
    -> 库存位置/数量（仓库、库位、库存状态）
      -> 单件或成本批次（来源、成本、照片、成色、入库时间）
```

是否必须追踪到“每一双”取决于用户规模和场景：

- 同款同尺码完全同质、只关心平均成本时，数量 + WAC 更轻。
- 成本、来源、成色、寄售状态或鉴别结果不同，单件/批次记录更可靠。
- 这不是 UI 选择，而是财务真实性和退货可追溯性的选择。

### 5.2 模式二：数量桶，而不是单一库存状态

可研究的通用数量桶：

- 现有：实际在仓的全部数量。
- 可售：没有被订单占用、没有瑕疵或质检冻结的数量。
- 已占用：已成交但尚未完成履约的数量。
- 不可售：瑕疵、质检、盘点差异或人工冻结。
- 在途：采购或调拨途中，尚未收货。

状态必须有守恒关系和事件来源，不能让用户随意编辑出互相矛盾的数字。

### 5.3 模式三：采购与收货分开，销售与结算分开

```text
采购：下单 -> 在途 -> 收货/差异 -> 可售
销售：成交 -> 占用 -> 待发货 -> 已发货 -> 平台收货
     -> 鉴别通过/失败 -> 结算/退回/退款
```

运营首页应优先显示“下一步要做什么”，而不是只显示累计金额。

### 5.4 模式四：扫描会话，而不是单次拍照表单

Stockist 和 Square 的公开流程都提示了批量现场操作的价值：先固定来源、仓库等共同上下文，连续扫描多件，再统一检查和提交。成熟扫描体验应包含：

- 连续扫描，不必每件返回首页。
- 重复扫描自动累加，但始终可撤销。
- 候选未匹配、多个候选和低置信度有不同提示。
- 提交前显示本次新增数量、总成本、异常项和重复项。
- 响应未知时不会重复入库。

### 5.5 模式五：利润是订单/结算结果，不是商品静态属性

真实净利润至少可能包含：

- 商品成本或成本批次。
- 平台交易费、技术服务费、查验费等。
- 卖家运费、退回运费、包装材料。
- 优惠、赔付、罚款、退款和费用更正。
- 成交与最终结算之间的差异。

因此“预估利润”和“实际结算利润”必须能同时存在，且保留当时的费用快照。

### 5.6 模式六：AI 嵌入任务，不替代业务状态机

可取模式：

- 从截图/文字提取候选字段。
- 解释库存、利润和滞销原因。
- 生成待确认的结构化操作计划。
- 对异常、缺失信息和风险进行提示。

危险模式：

- AI 直接绕过库存、订单和费用校验写数据库。
- 用自然语言“完成了”掩盖真实状态仍是待发货或待结算。
- 模型猜测品牌、尺码、成本或平台费后自动执行。

## 6. 对当前 App 的研究性诊断

以下是问题诊断，不是已批准的改造方案。

### 6.1 当前强项

- 已经具备比许多早期转售工具更严谨的数据安全基础：RLS、幂等操作、事务 RPC、软删除与恢复、数据体检、完整账本备份、费用快照和结算更正审计。
- 入库草稿、图片可靠性、批量入库、调拨和异常恢复已经考虑移动端中断与重复提交。
- AI 执行已经采用“先计划、再确认、一次性执行”的可控方式，而不是直接让模型写库存。

这些能力在竞品营销页中往往不是显性卖点，但它们是正式经营工具建立信任的基础。

### 6.2 核心结构问题

| 观察 | 当前影响 | 竞品/成熟模式对照 | 证据强度 |
|---|---|---|---|
| `products` 同时承载名称、品牌、货号、尺码、仓库、数量、成本和状态 | 同一货号跨仓可能出现不同名称/品牌；主数据容易漂移 | Synkei、Shopify、Zoho 均先分父商品与变体，再分位置库存 | 代码与只读数据审计，强 |
| `status` 主要是 instock/shipping/sold/flaw | 无法表达可售、已占用、待发货、鉴别、退回、退款、结算 | Shopify 数量桶；得物/StockX/eBay 订单状态链 | 代码 + A 级外部证据，强 |
| 卖出操作直接扣库存并写出库流水 | 之后若未发货、鉴别失败、取消或退回，没有独立业务对象承接 | StockX/eBay 将销售、物流、鉴别、结算分开 | 代码 + A 级外部证据，强 |
| 商品联想来自用户自己的库存 | 只能复用已经录过的货号，不能识别第一次出现的新商品 | FootVault/Synkei/SneakScan 使用目录或外部候选源 | 代码 + B 级外部证据，强 |
| 拍照入口目前是文件输入 + `capture="environment"` | 能拍商品图，但不是实时条码/OCR 识别链 | ML Kit 可提供原生离线识别能力 | 代码 + A 级技术证据，强 |
| 库存主要按当前仓库浏览 | 全局查货、跨仓对比和调拨决策需要反复切换 | Shopify 明确提供 All locations | 代码/界面 + A 级外部证据，中强 |
| 费用方案与结算依赖人工配置/补录 | 可以保持账目诚实，但不能自动代表得物实时费率和最终回款 | 成熟系统区分预估与实际，并连接订单/付款 | 代码与业务规则，强 |
| 首页以销售额、库存等摘要为主 | 高频“待发货、即将超时、待鉴别、待结算、异常待处理”没有统一任务面板 | PairFlow、Sire、StockX Pro 更强调订单与下一动作 | B 级外部证据 + 界面观察，中 |

只读数据审计曾观察到同一货号 `DD1391` 在不同仓库出现 Nike 商品名与“未知品牌”并存。这不是排版问题，而是商品主数据与库存行混合后产生的一致性风险。

### 6.3 当前产品定位判断（D）

当前 App 更接近：

> 一个安全性和可恢复性较强的个人卖家库存与经营账本。

它尚不能被称为完整的个人卖家操作系统，主要不是因为界面不够漂亮，而是缺少：

- 权威或可治理的商品主数据。
- 独立销售订单及履约、鉴别、退回、退款和结算状态。
- 库存数量桶和全仓视角。
- 识别候选到人工确认的扫描链。
- 围绕“下一项待办”的日常操作中心。

## 7. 反模式清单

这些模式未来设计时应主动拦截：

1. **把商品身份复制到每条仓库库存行。** 修改一处无法保证所有仓库同步。
2. **把“已卖出”当作交易终态。** 会遗漏发货、鉴别、退货和资金风险。
3. **OCR/扫码后直接入库。** 候选错误会被自动放大为主数据污染。
4. **用来源不明的固定费率计算“真实利润”。** 平台规则、卖家等级和交易模式会变化。
5. **首页只有大数字，没有待办。** 数据看起来丰富，但不能减少卖家的下一步判断成本。
6. **所有调整都叫“修改库存”。** 收货、盘点、瑕疵、丢失、调拨和退货应有不同原因与审计。
7. **为了追求少输入而默认猜测关键字段。** 品牌、货号、尺码、仓库和成本错误通常比多点一次更昂贵。
8. **直接照搬企业 ERP。** 个人卖家需要更低输入成本，但仍需要保留关键业务语义。
9. **只比较功能是否存在。** 不比较完成任务的步骤、异常恢复、信息可信度和使用频率。
10. **把营销页宣称当成竞品已验证能力。** 早期转售产品的公开演示和评价数量有限。

## 8. 下一轮研究，不进入方案设计

### 8.1 用户任务研究

至少覆盖三种规模：

- 10-50 双：兼职、单仓、低频出入库。
- 50-300 双：稳定经营、多来源、多平台、需要批量操作。
- 300 双以上：多仓或团队、条码/库位/拣货/对账成为刚需。

建议收集 10-20 份真实任务日记，而不是只问“你想要什么功能”：

- 一双鞋从买到卖的完整时间线。
- 每次在哪个 App、聊天、表格或相册间切换。
- 最常忘记、最容易错、最担心无法恢复的环节。
- 得物订单状态、费用、鉴别失败和结算截图的字段结构。
- 每天/每周/每月真正会看的数字与做出的决定。

### 8.2 鞋盒标签样本研究

需要建立脱敏样本集，覆盖 Nike/Jordan、Adidas、New Balance、ASICS、Puma、国产品牌等：

- 正面、倾斜、反光、低光、磨损和部分遮挡。
- 不同地区标签和不同尺码体系。
- 条码原始值、OCR 原始文本和人工真值。
- 哪些品牌能由货号唯一确定款式，哪些不能。

在没有样本准确率之前，不承诺“拍一下自动入库”。

### 8.3 竞品实测

对可注册产品完成相同任务脚本并计步：

1. 新增同款三个尺码，两个仓库，不同成本。
2. 找到一双鞋并生成/扫描内部标签。
3. 卖出但不发货，第二天继续处理。
4. 记录鉴别失败并恢复库存与费用。
5. 做跨仓调拨、部分收货和盘点差异。
6. 查看某一来源、商品、尺码和平台的实际净利润。
7. 导出后验证能否重建数据。

重点记录：步骤数、必填字段、错误提示、是否能撤销、离线/中断后是否恢复、数据是否解释得清楚。

### 8.4 商业与数据合规研究

- 商品图、平台价格和目录数据是否允许缓存、再展示和商业使用。
- 得物个人卖家是否存在合法的数据导出、通知解析或用户主动导入路径。
- 第三方目录接口的授权、限流、覆盖率、地区和价格。
- 自建商品库的审核成本、错误责任、用户纠错和数据许可证。

## 9. 第一轮研究结论

1. **当前最重要的不是继续压缩卡片或增加一个扫描按钮，而是先确认产品要服务哪一段卖家经营链。**
2. **商品库是长期基础设施；OCR、条码和二维码只是进入商品库或已有库存记录的不同入口。**
3. **得物类交易的终点不是出库，而是履约、鉴别和结算闭环。**
4. **当前 App 的安全与可恢复基础值得保留，它可能成为相对早期竞品的真实优势。**
5. **当前最大缺口是业务语义和信息架构，而不是视觉精致度。**
6. **在真实卖家任务、鞋盒标签样本和竞品实测完成前，不应冻结新的产品方案。**

## 10. 来源索引（访问于 2026-08-11）

### 直接与相邻竞品

- [PairFlow](https://pairflow.co/)
- [FootVault](https://www.footvault.dev/)
- [FootVault QR Scanner](https://www.footvault.dev/features/qr-scanner)
- [Synkei](https://www.synkei.com/en/index.html)
- [Revnu](https://www.revnu.net/)
- [Sire](https://home.sireapp.io/)
- [Resylr inventory labels](https://www.resylr.com/reseller-inventory-labels/)
- [Stockist](https://getstockist.co.uk/)
- [SneakScan](https://sneakscan.com/)
- [Flippd App Store](https://apps.apple.com/us/app/flippd-reseller-inventory/id1633899291)
- [Rivet Google Play](https://play.google.com/store/apps/details?id=com.rivets.inventory)
- [SellerBook 2 Google Play](https://play.google.com/store/apps/details?id=com.sellerbook2.production)

### 库存、零售与交易平台

- [Shopify inventory states](https://help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states)
- [Shopify variant search and locations](https://help.shopify.com/en/manual/products/variants/searching-filtering)
- [Zoho item and variant model](https://www.zoho.com/us/inventory/help/items/items-overview.html)
- [Zoho item groups and opening stock](https://www.zoho.com/inventory/help/items/item-creation.html)
- [Square items and inventory](https://squareup.com/help/us/en/topic/items-and-inventory)
- [Square transfer orders](https://squareup.com/help/us/en/article/8300-create-transfer-orders-with-square-for-retail)
- [得物个人卖家入口](https://dewu.com/personal-enter.html)
- [得物企业商家入口](https://dewu.com/store)
- [得物商品状态体系](https://tech.dewu.com/article?id=91)
- [StockX seller shipping](https://stockx.com/help/articles/how-does-shipping-on-stockx-work-for-sellers)
- [StockX seller payout](https://stockx.com/help/articles/As-a-Seller-how-and-when-do-I-get-paid)
- [StockX verification](https://stockx.com/help/articles/what-does-the-verification-process-entail-for-sellers/P2Kc5EaiSY-osU1ZWF6joA)
- [eBay sold-item tracking](https://www.ebay.com/help/selling/shipping-items/tracking-items-youve-sold?id=4088)
- [eBay returns and refunds](https://www.ebay.com/help/selling/managing-returns-refunds/manage-returns-missing-items-refunds-sellers?id=4079)

### 识别与目录基础设施

- [ML Kit barcode scanning](https://developers.google.com/ml-kit/vision/barcode-scanning/android)
- [ML Kit text recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2)
- [eBay Browse API](https://developer.ebay.com/api-docs/buy/api-browse.html)
- [StockX Developer Portal](https://developer.stockx.com/portal/api-reference)（公开页面需要进一步确认申请和授权范围）
