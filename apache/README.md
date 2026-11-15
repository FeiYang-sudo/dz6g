# Apache 配置

`site-dz6g.conf` 是从服务器 `/etc/apache2/sites-available/000-default.conf` 拷来的当前配置（已确认无敏感信息）。

## 关键点

- **80 端口的默认站点**就是官网（DocumentRoot 指向 `/var/www/dz6g`）
- **Flarum 挂在 `/board`**：靠 `Alias` + `RewriteRule` 把子路径映射到 `/var/www/flarum/public`
- **日记挂在 `/diary`**，邮件客户端 `/mail`（SnappyMail）
- 对外访问实际走 **Cloudflare 隧道**（`cloudflared`），Apache 只监听本地

## 启用

```bash
sudo cp site-dz6g.conf /etc/apache2/sites-available/000-default.conf
sudo a2enmod rewrite headers alias proxy_fcgi
sudo apache2ctl configtest && sudo systemctl reload apache2
```

`php.ini.sample` 是当前 PHP 8.3 的配置备份，仅供参考（注意里面的上传限制、内存限制）。
