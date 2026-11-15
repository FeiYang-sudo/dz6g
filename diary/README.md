# 私人日记站

页面由脚本生成，**不包含任何日记内容**（内容只存在服务器本地）。

## 结构

| 文件 | 说明 |
|---|---|
| `diary_site.py` | 生成器：读日记数据 → 输出 `index.html`（月历 + 金色时间轴 + 统计条）|
| `index.html` | **生成产物，已被 .gitignore 排除**（含私人内容）|

## 在服务器上重新生成

```bash
python3 /root/.hermes/scripts/diary_site.py     # 每晚 22:00 由 Hermes cron 自动跑
# 产物写到 /var/www/diary/index.html，访问 https://dz6g.ccwu.cc/diary/（带访问密码）
```

## 隐私

日记内容只在服务器上，**任何时候都不要把 `index.html` 提交到公开仓库**。
