# 日语质量参考与审校

## 原则

1. **不直接复制教材原文**。教材、语料和词典用于核对语法、搭配和读音；场景和对话保持原创。
2. **结构贴合真实场景**。对话场景控制在 5–6 句（最多 6 句），短文控制在 5–6 段；日文正文自然连写，不加人为分词空格。
3. **读音优先查词典和重音词典**，尤其是数字、日期、量词、人名、多音词。
4. **自然度看真实语料和例句搭配**，避免直译腔、翻译腔和教科书式生硬表达。
5. **不确定就标出**，不把猜测写成确定结论。
6. **音频与文本严格同步**：同一场景同一角色在 `speakers[].voice` 固定声线，`public/audio/manifest.json` 校验 `voice + ja` 哈希，单句循环只包含当前句。

## 参考源

| 用途 | 资源 |
|---|---|
| 初级到中级场景、语法和表达 | [Japan Foundation Irodori](https://www.jpf.go.jp/e/project/japanese/education/irodori/) |
| 在线日语学习课程与场景 | [JF Japanese e-Learning Minato](https://minato-jf.jp/) |
| 自然新闻与浅易书面日语 | [NHK Easy News](https://www3.nhk.or.jp/news/easy/) |
| 汉字读音、词语释义 | [JMdict / EDICT](https://www.edrdg.org/jmdict/j_jmdict.html) |
| 日语重音与语调 | [OJAD](https://www.gavo.t.u-tokyo.ac.jp/ojad/) |
| 真实书面语搭配与语料 | [BCCWJ / 少納言](https://shonagon.ninjal.ac.jp/) |

## 审校顺序

1. 先看句子是否表达了场景里真实会说的话，以及对话是否 5–6 句完整闭合。
2. 再看助词、时态、敬语和固定搭配，并确认无多余分词空格。
3. 再核对汉字读音（`{漢字|かんじ}`）和数量词、日期读法。
4. 最后核对中日语意一一对应及音频哈希一致。

## 使用边界

- Irodori、Minato、NHK Easy 等材料有版权，只作为参考，不整段搬运。
- BCCWJ 用于观察真实搭配和频率，不直接复制语料句子。
- 语料和教材也会有地区差异、年代差异；优先选择现代、自然的日常表达。
- 最终仍以人工逐条审读为准，不把词典或语料查询当作唯一答案。
