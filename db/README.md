# 数据库

论坛（Flarum）**用的是 SQLite**，不是 MySQL —— 这点容易搞错。

| 文件 | 说明 |
|---|---|
| `schema.sqlite.sql` | **只有表结构**（82 个表/索引/视图），重装时可直接 `sqlite3 flarum.db.sqlite < schema.sqlite.sql` |
| 实际数据库 | 服务器上位于 `/var/www/flarum/storage/flarum.db.sqlite`（约 500KB）|

## 为什么不传数据

数据库里是**真实用户、帖子、私信、附件索引**，属于隐私数据，不进公开仓库。

## 备份数据库（在服务器上执行）

```bash
# 冷备（推荐先停论坛再拷）
cp /var/www/flarum/storage/flarum.db.sqlite /root/backup/flarum-$(date +%F).sqlite

# 热备（用 sqlite3 的 .backup，不需要停服）
sqlite3 /var/www/flarum/storage/flarum.db.sqlite ".backup '/root/backup/flarum-$(date +%F).sqlite'"
```

## 重建

```bash
touch /var/www/flarum/storage/flarum.db.sqlite
sqlite3 /var/www/flarum/storage/flarum.db.sqlite < schema.sqlite.sql
cd /var/www/flarum && php flarum migrate && php flarum cache:clear
```
