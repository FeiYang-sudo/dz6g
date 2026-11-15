# Flarum 论坛（定制部分）

论坛本体在 `/var/www/flarum`。这里只保存**自有的定制内容**，不含第三方 vendor、不含数据库、不含配置密钥。

## 本目录内容

| 目录 | 是什么 |
|---|---|
| `extensions/casdoor-oauth/` | 自制扩展：Casdoor 单点登录（含 Cloudflare 回环延迟优化）|
| `extensions/flarum-zh-cn/` | 自制中文语言包（站点文案定制）|
| `extensions/fof-js-inject/` | JS/CSS 注入扩展（前端定制）|
| `vendor-local/flarum-zh-cn/` | 第二份中文语言包（官方 `flarum-lang/chinese-simplified` 的本地改装）|
| `email-templates/` | 改过的邮件模板（注册验证 / 通知）|
| `build-artifacts/` | 编译后的 `forum.css` / `admin.css`（含自定义样式，仅供参考）|
| `composer.json` | 扩展依赖清单（重装时按它装）|

## 重装步骤

```bash
# 1. 装 Flarum（同版本）
composer create-project flarum/flarum .

# 2. 按 composer.json 里的扩展清单安装
composer require flarum-lang/chinese-simplified flarum/tags flarum/likes ...

# 3. 覆盖定制文件
cp -r extensions/* /var/www/flarum/extensions/
cp -r vendor-local/flarum-zh-cn/* /var/www/flarum/vendor/local/flarum-zh-cn/
cp -r email-templates/email/* /var/www/flarum/vendor/flarum/core/views/email/

# 4. 清缓存
cd /var/www/flarum && php flarum cache:clear
```

## ⚠️ 未包含（需自行配置）

- `config.php` —— 含数据库账号密码，**绝不入库**
- 数据库数据（用户、帖子、附件）
- `vendor/`（第三方依赖，用 composer 装）
- `storage/`（上传的附件、缓存）
- Casdoor 的 `client_id` / `client_secret` —— 在论坛后台「扩展设置」里配

## 环境

- Flarum 2.x · PHP 8.3 · MySQL
- 跑在 Apache 子路径 `/board`（见官网仓库根目录的 Apache 配置说明）
- 登录走 Casdoor SSO（`client_id=68cbaa8b0612ec4de274`）
