#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 /root/diary/entries/*.md 生成为手机可看的网页（/var/www/diary/index.html）。

设计：日记源文件留在 /root（锁死），这里只发布一份只读副本给 Apache（带密码）。
无外部依赖、无 CDN，手机端优先，黑金配色跟学校站一致。

日期能力（v2）：
  · 月历视图：有日记的日子按情绪强度着色，点格子跳到那天
  · 月份导航：‹ › 翻月 + 下拉直选，跨月/跨年不迷路
  · 日期显示：10月5日 周一 + 今天/昨天/前天，跨年自动补年份
  · 时间轴导轨 + 月份标题吸顶 + 日期统计（总天数/本月/连续/总字数）
  · 支持 #YYYY-MM-DD 锚点直达并高亮

用法：python3 ~/.hermes/scripts/diary_site.py
"""
import os, re, glob, html, json, collections, datetime

EDIR = "/root/diary/entries"
OUT = "/var/www/diary/index.html"
WEEK = "一二三四五六日"          # weekday() = 0 → 周一
REL = {0: "今天", 1: "昨天", 2: "前天"}


def esc(s):
    return html.escape(s, quote=False)


def inline(s):
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def parse(path):
    raw = open(path, encoding="utf-8").read()
    day = os.path.basename(path)[:-3]
    d = {"day": day, "title": "", "secs": [], "mood": [], "words": [], "level": None, "one": "", "chars": 0}
    d["chars"] = len(re.sub(r"\s+", "", raw))
    cur = None
    for line in raw.splitlines():
        s = line.rstrip()
        if s.startswith("# "):
            d["title"] = s[2:].strip()
        elif s.startswith("## "):
            cur = {"h": s[3:].strip(), "lines": []}
            d["secs"].append(cur)
        elif cur is not None and s.strip():
            cur["lines"].append(s.strip())
    for sec in d["secs"]:
        for l in sec["lines"]:
            m = re.match(r"-\s*基调[：:]\s*(.+)", l)
            if m:
                d["mood"] = [x.strip() for x in re.split(r"[|/、,，\s]+", m.group(1)) if x.strip()]
            m = re.match(r"-\s*情绪词[：:]\s*(.+)", l)
            if m:
                d["words"] = [x.strip() for x in re.split(r"[,，、\s]+", m.group(1)) if x.strip()]
            m = re.match(r"-\s*强度[：:]\s*(\d)", l)
            if m:
                d["level"] = int(m.group(1))
        if sec["h"] == "一句话" and sec["lines"]:
            d["one"] = sec["lines"][0]
    return d


MOOD_CLS = {"亢奋": "up", "平静": "calm", "烦躁": "bad", "低落": "low", "没睡": "tired"}


def d2c(day):
    return datetime.date(*map(int, day.split("-")))


def month_list(first, last):
    """从最早到最晚的连续月份列表 [(YYYY-MM), ...]"""
    if not first or not last:
        return []
    a, b = d2c(first), d2c(last)
    out, y, m = [], a.year, a.month
    while (y, m) <= (b.year, b.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def pretty_month(mon):
    y, m = mon.split("-")
    return f"{y}年{int(m)}月"


def streak_days(days):
    """以最后一篇为终点，往前数连续天数"""
    if not days:
        return 0
    st = set(days)
    cur = d2c(max(days))
    k = 0
    while cur.isoformat() in st:
        k += 1
        cur -= datetime.timedelta(days=1)
    return k


def render(items):
    n = len(items)
    if not items:
        body_empty = '<div class="empty">还没有日记。今晚 22:00 会写第一篇。</div>'
    else:
        body_empty = ""

    items_s = sorted(items, key=lambda x: x["day"])                    # 升序
    days = [d["day"] for d in items_s]
    latest = days[-1] if days else None
    first = days[0] if days else None
    today = datetime.date.today()
    today_s = today.isoformat()

    # ── 统计 ──
    lv = [d["level"] for d in items if d["level"]]
    avg = f"{sum(lv) / len(lv):.1f}" if lv else "—"
    this_month = sum(1 for x in days if x.startswith(today_s[:7]))
    streak = streak_days(days)
    total_chars = sum(d["chars"] for d in items)

    # ── 基调 / 情绪词面板 ──
    mood_n = collections.Counter(m for d in items for m in d["mood"])
    words = collections.Counter(w for d in items for w in d["words"])
    stat_bars = "".join(
        f'<div class="bar"><span>{esc(k)}</span><i class="track"><b style="width:{v / max(mood_n.values()) * 100:.1f}%"></b></i><em>{v} 次</em></div>'
        for k, v in mood_n.most_common()
    )
    stat_words = "".join(f'<span class="chip">{esc(w)}<i>{c}</i></span>' for w, c in words.most_common(16))

    # ── 日期卡片 ──
    out = []
    cur_month = None
    for d in sorted(items, key=lambda x: x["day"], reverse=True):
        mon = d["day"][:7]
        if mon != cur_month:
            cur_month = mon
            cnt = sum(1 for x in days if x.startswith(mon))
            out.append(f'<h2 class="mon" data-m="{mon}">{pretty_month(mon)}<em>{cnt} 天</em></h2>')
        try:
            dt = d2c(d["day"])
            wd = WEEK[dt.weekday()]
        except Exception:
            dt, wd = None, ""
        # 相对标签：今天 / 昨天 / 前天
        rel = ""
        if dt:
            delta = (today - dt).days
            if delta in REL:
                rel = f'<span class="rel">{REL[delta]}</span>'
        # 跨年补年份
        ymd = d["day"]
        if dt and dt.year != today.year:
            ymd = f'{dt.year}年{dt.month}月{dt.day}日'
        elif dt:
            ymd = f'{dt.month}月{dt.day}日'
        badges = "".join(f'<span class="mood {MOOD_CLS.get(m, "calm")}">{esc(m)}</span>' for m in d["mood"]) or '<span class="mood calm">—</span>'
        stars = "".join('<i class="s on"></i>' if i < (d["level"] or 0) else '<i class="s"></i>' for i in range(1, 6))
        body = []
        for sec in d["secs"]:
            if sec["h"] == "情绪":
                continue
            if sec["h"] == "一句话":
                body.append(f'<p class="one">{inline(" ".join(sec["lines"]))}</p>')
                continue
            lis = [l[2:] if l.startswith("- ") else l for l in sec["lines"]]
            body.append(f'<h3>{esc(sec["h"])}</h3><ul>' + "".join(f"<li>{inline(x)}</li>" for x in lis) + "</ul>")
        kw = " ".join(d["words"])
        rel_txt = REL.get((today - dt).days, "") if dt else ""     # 纯文本，不带标签
        out.append(f'''<article class="card" id="{d["day"]}" data-k="{esc(kw)} {esc(d["day"])} {ymd} {esc(rel_txt)}">
  <header><span class="date">{ymd}</span><span class="wd">周{wd}</span>{rel}{badges}<span class="lvl"><em>强度 {d["level"] or "—"}/5</em>{stars}</span></header>
  {"".join(body)}
  <footer>{esc(d["day"])}</footer>
</article>''')

    # ── 日历数据 ──
    cal = {d["day"]: {"l": d["level"] or 0, "m": d["mood"][:1], "o": d["one"][:36]} for d in items}
    months = month_list(first, latest)
    if months and months[-1] != today_s[:7] and today_s[:7] > months[-1]:
        months.append(today_s[:7])          # 让日历默认能停在本月

    data = {
        "days": cal,
        "months": months,
        "latest": latest,
        "first": first,
        "today": today_s,
        "counts": {m: sum(1 for x in days if x.startswith(m)) for m in months},
    }

    stat_cells = "".join([
        f'<div class="st"><b>{n}</b><span>总天数</span></div>',
        f'<div class="st"><b>{this_month}</b><span>本月</span></div>',
        f'<div class="st"><b>{streak}</b><span>连续记录</span></div>',
        f'<div class="st"><b>{total_chars:,}</b><span>总字数</span></div>',
    ])

    return f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f7f6f3">
<title>日记</title>
<style>
/* 日间（默认，白底）与夜间两套变量，其余样式只吃变量 */
:root{{--bg:#f4f2ee;--card:#fff;--ink:#1b1a18;--dim:#5f5c55;--line:#e2ded6;--gold:#a8823c;--gold2:#7f6024;--one:#6b5320;--soft:#f2efe9;--li:#2f2d2a;--code:#efece5;--codeink:#5f4a1c;--foot:#605c55;--sqbg:#ece8e0;--ph:#8b877f;--dot:#cfc9be;--bar1:#d3bd8f;--shadow:0 1px 3px rgba(0,0,0,.06);--rail:#e7e2d8}}
body.dark{{--bg:#0b0b0b;--card:#141414;--ink:#eae6de;--dim:#928e86;--line:#262626;--gold:#c9a96e;--gold2:#8d7548;
--soft:#181818;--li:#d8d4cc;--code:#1c1c1c;--codeink:#c9a96e;--foot:#6b6862;--sqbg:#1d1a14;--ph:#6f6c66;
--dot:#242424;--bar1:#8d7548;--shadow:none;--rail:#242424}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:17px/1.9 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif;-webkit-text-size-adjust:100%}}
.wrap{{max-width:680px;margin:0 auto;padding:26px 18px 80px}}
h1{{font:600 34px/1.2 "Noto Serif CJK SC","Songti SC",serif;color:var(--gold2);letter-spacing:.12em;margin:.4em 0 .1em}}
.sub{{color:var(--dim);font-size:13px;letter-spacing:.06em;margin-bottom:18px}}
#t{{position:fixed;top:14px;right:14px;width:40px;height:40px;border-radius:50%;border:1px solid var(--line);
background:var(--card);color:var(--gold2);font-size:17px;line-height:1;cursor:pointer;box-shadow:var(--shadow);z-index:9}}

/* ── 日期统计条 ── */
.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}}
.st{{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 6px;text-align:center;box-shadow:var(--shadow)}}
.st b{{display:block;font:600 21px/1.25 "Noto Serif CJK SC",serif;color:var(--gold2)}}
.st span{{font-size:11px;color:var(--dim);letter-spacing:.04em}}

/* ── 视图切换 ── */
.seg{{display:flex;gap:0;border:1px solid var(--line);border-radius:11px;overflow:hidden;margin-bottom:12px;background:var(--card)}}
.seg button{{flex:1;border:0;background:transparent;color:var(--dim);font:inherit;font-size:14px;padding:9px 0;cursor:pointer}}
.seg button.on{{background:var(--gold);color:#fff;font-weight:600}}
body.dark .seg button.on{{color:#0b0b0b}}

/* ── 月份导航 ── */
.mnav{{display:flex;align-items:center;gap:8px;margin-bottom:12px}}
.mnav button{{width:38px;height:38px;flex:none;border:1px solid var(--line);border-radius:10px;background:var(--soft);
color:var(--gold2);font-size:22px;font-weight:700;line-height:1;cursor:pointer;box-shadow:var(--shadow)}}
.mnav button:disabled{{opacity:.35;cursor:default}}
.msel{{flex:1;position:relative;display:flex;align-items:center}}
#ms{{flex:1;font:inherit;font-size:15px;padding:8px 32px 8px 10px;border:1px solid var(--line);border-radius:10px;
background:var(--card);color:var(--ink);-webkit-appearance:none;appearance:none;text-align:center}}
.caret{{position:absolute;right:11px;color:var(--gold2);font-size:12px;font-style:normal;pointer-events:none}}

/* ── 月历 ── */
#cal{{display:none;border:1px solid var(--line);border-radius:14px;background:var(--card);padding:12px 8px 10px;margin-bottom:16px;box-shadow:var(--shadow)}}
#cal table{{width:100%;border-collapse:separate;border-spacing:3px;table-layout:fixed}}
#cal th{{font:600 11px/1 sans-serif;font-weight:600;color:var(--dim);padding-bottom:6px}}
#cal td{{text-align:center;vertical-align:middle}}
.cd{{display:flex;flex-direction:column;align-items:center;justify-content:center;height:40px;border-radius:9px;
font-size:13px;color:var(--dim);text-decoration:none;cursor:default;border:1px solid transparent}}
.cd.has{{color:var(--gold2);font-weight:700;cursor:pointer;border-color:var(--line)}}
.cd.today{{border-color:var(--gold);box-shadow:0 0 0 1.5px var(--gold)}}
.cd u{{display:block;font-size:8px;line-height:1;text-decoration:none;margin-top:2px;color:var(--gold);opacity:.85}}
.cd em{{position:absolute;font-size:0}}
.calnote{{font-size:11px;color:var(--dim);text-align:center;padding-top:8px;letter-spacing:.04em}}

/* ── 面板 ── */
.panel{{border:1px solid var(--line);border-radius:14px;padding:16px 16px 10px;background:var(--card);margin-bottom:18px;box-shadow:var(--shadow)}}
.panel h4{{margin:0 0 10px;font:600 12px/1 sans-serif;color:var(--gold2);letter-spacing:.22em;text-transform:uppercase}}
.bar{{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dim);margin:6px 0}}
.bar span{{width:3.4em;flex:none}}
.track{{flex:1;min-width:0;display:block}}
.track b{{display:block;height:8px;background:linear-gradient(90deg,var(--bar1),var(--gold));border-radius:4px}}
.bar em{{font-style:normal;font-size:11px;color:var(--dim);margin-left:auto;white-space:nowrap;flex:none}}
.chip{{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:3px 10px 3px 12px;font-size:12px;color:var(--dim);background:var(--soft);margin:3px 6px 3px 0}}
.chip i{{font-style:normal;color:var(--gold2);margin-left:5px}}

/* ── 列表 + 时间轴 ── */
#list{{position:relative;padding-left:24px}}
#list:before{{content:"";position:absolute;left:7px;top:8px;bottom:8px;width:2px;background:var(--rail)}}
.mon{{position:sticky;top:0;z-index:3;background:var(--bg);font:700 15px/1 sans-serif;color:var(--gold2);
letter-spacing:.14em;margin:28px -2px 14px;padding:11px 12px 10px;border-bottom:1px solid var(--line);
border-left:3px solid var(--gold)}}
.mon em{{font-style:normal;float:right;font-size:11px;color:var(--dim);letter-spacing:.04em}}
.card{{position:relative;border:1px solid var(--line);border-left:1px solid var(--line);border-radius:12px;
background:var(--card);box-shadow:var(--shadow);padding:16px 17px 12px;margin:0 0 16px}}
.card:before{{content:"";position:absolute;left:-22px;top:21px;width:10px;height:10px;border-radius:50%;
background:var(--gold);box-shadow:0 0 0 3px var(--bg)}}
.card:target,.card.hl{{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,169,110,.28)}}
.card header{{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}}
.date{{font:600 20px/1 "Noto Serif CJK SC",serif;color:var(--gold2)}}
.wd{{color:var(--dim);font-size:12px}}
.rel{{font-size:11px;font-weight:600;color:#fff;background:var(--gold);border-radius:999px;padding:2px 8px}}
body.dark .rel{{color:#0b0b0b}}
.mood{{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid}}
.lvl{{margin-left:auto;display:flex;gap:3px;align-items:center}} .lvl em{{font-style:normal;font-size:10px;color:var(--dim);margin-right:5px}}
.s{{display:block;width:6px;height:6px;border-radius:50%;background:var(--dot)}} .s.on{{background:var(--gold)}}
h3{{font:600 12px/1 sans-serif;color:var(--gold2);letter-spacing:.2em;margin:20px 0 10px}}
ul{{margin:0;padding-left:19px}} li{{margin:10px 0;color:var(--li)}} li:last-child{{margin-bottom:2px}}
code{{background:var(--code);border-radius:4px;padding:1px 5px;font-size:13px;color:var(--codeink)}}
.one{{font:600 19px/1.6 "Noto Serif CJK SC",serif;color:var(--one);border-top:1px solid var(--line);margin:16px 0 0;padding-top:14px}}
.card footer{{color:var(--foot);font-size:11px;letter-spacing:.14em;margin-top:12px;text-align:right}}
#q{{width:100%;background:#fff;border:1px solid #dcd7ce;border-radius:10px;color:var(--ink);padding:13px 14px;font-size:16px;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}}
#q::placeholder{{color:var(--ph)}}
#q:focus{{outline:none;border-color:var(--gold)}}
body.dark #q{{background:#141414;border-color:#262626}}
.empty{{color:var(--dim);text-align:center;padding:60px 0}}
.mood.up{{color:#8a6520;background:#fbf2df;border-color:#e8d7ae}}
.mood.calm{{color:#55606a;background:#f0f3f4;border-color:#dde3e5}}
.mood.bad{{color:#a83f36;background:#fbeeec;border-color:#eed6d2}}
.mood.low{{color:#3f6383;background:#eef4f9;border-color:#d8e5ef}}
.mood.tired{{color:#5f5f72;background:#f1f0f6;border-color:#e0dfe9}}
body.dark .mood.up{{color:#d8b46a;background:transparent;border-color:#4a3d20}}
body.dark .mood.calm{{color:#9aa3a8;background:transparent;border-color:#2c3336}}
body.dark .mood.bad{{color:#c96a6a;background:transparent;border-color:#4a2626}}
body.dark .mood.low{{color:#6f8ba8;background:transparent;border-color:#243240}}
body.dark .mood.tired{{color:#8b8b9a;background:transparent;border-color:#2e2e3a}}
</style></head><body><div class="wrap">
<button id="t" title="日间 / 夜间">☾</button>
<h1>日记</h1>
<div class="sub">只有你自己能看 · 共 {n} 天 · 平均强度 {avg}</div>

<div class="stats">{stat_cells}</div>

<div class="seg"><button id="vlist" class="on">列表</button><button id="vcal">日历</button></div>

<nav class="mnav">
  <button id="mp" title="上个月">‹</button>
  <span class="msel"><select id="ms"></select><i class="caret">▾</i></span>
  <button id="mn" title="下个月">›</button>
</nav>

<div id="cal"><table><thead><tr><th>一</th><th>二</th><th>三</th><th>四</th><th>五</th><th>六</th><th>日</th></tr></thead><tbody id="cb"></tbody></table>
<div class="calnote" id="cnote"></div></div>

<div class="panel"><h4>基调分布 · 按情绪词次数</h4>{stat_bars or '<div class="bar"><span>暂无</span></div>'}</div>
<div class="panel"><h4>情绪词</h4>{stat_words or '<span class="chip">暂无</span>'}</div>
<input id="q" placeholder="搜一句，或输 10-05 定位日期">
<div id="list">
{"".join(out) if out else body_empty}
</div></div>
<script>
var DATA = {json.dumps(data, ensure_ascii=False)};

/* ── 主题 ── */
(function(){{
  var b=document.body,t=document.getElementById("t");
  if(localStorage.getItem("diary_theme")==="dark"){{b.classList.add("dark");t.textContent="☀";}}
  t.addEventListener("click",function(){{
    b.classList.toggle("dark");
    var d=b.classList.contains("dark");
    t.textContent=d?"☀":"☾";
    localStorage.setItem("diary_theme",d?"dark":"light");
  }});
}})();

/* ── 搜索（按正文 + 日期） ── */
var q=document.getElementById("q"),cards=[].slice.call(document.querySelectorAll(".card")),
    mons=[].slice.call(document.querySelectorAll(".mon"));
function filter(){{
  var v=q.value.trim().toLowerCase();
  cards.forEach(function(c){{
    c.style.display=(!v||(c.textContent+" "+c.dataset.k).toLowerCase().indexOf(v)>=0)?"":"none";
  }});
  mons.forEach(function(m){{
    var seen=false,n=m.nextElementSibling;
    while(n&&!n.classList.contains("mon")){{if(n.classList.contains("card")&&n.style.display!="none")seen=true;n=n.nextElementSibling;}}
    m.style.display=seen?"":"none";
  }});
}}
q.addEventListener("input",filter);

/* ── 视图切换 ── */
var vlist=document.getElementById("vlist"),vcal=document.getElementById("vcal"),
    cal=document.getElementById("cal"),list=document.getElementById("list");
function setView(v){{
  var isCal=(v==="cal");
  vcal.classList.toggle("on",isCal); vlist.classList.toggle("on",!isCal);
  cal.style.display=isCal?"block":"none";
  list.style.display=isCal?"none":"";
  document.querySelector(".mnav").style.display=isCal?"flex":"none";
  localStorage.setItem("diary_view",v);
  if(isCal) drawCal(curMon);
}}
vlist.addEventListener("click",function(){{setView("list");}});
vcal.addEventListener("click",function(){{setView("cal");}});

/* ── 月历 ── */
var ms=document.getElementById("ms"),cb=document.getElementById("cb"),cnote=document.getElementById("cnote"),
    mp=document.getElementById("mp"),mn=document.getElementById("mn");
var curMon=DATA.months.length?DATA.months[DATA.months.length-1]:DATA.today.slice(0,7);

DATA.months.forEach(function(m){{
  var o=document.createElement("option");
  var c=DATA.counts[m]||0;
  o.value=m; o.textContent=m.slice(0,4)+"年"+parseInt(m.slice(5),10)+"月"+(c?" · "+c+"天":"");
  ms.appendChild(o);
}});
ms.value=curMon;

var LBL=["","情绪很好","状态不错","一般","有点糟","很糟"];
function drawCal(mon){{
  curMon=mon; ms.value=mon;
  var i=DATA.months.indexOf(mon);
  mp.disabled=(i<=0); mn.disabled=(i<0||i>=DATA.months.length-1);
  cb.innerHTML="";
  var y=parseInt(mon.slice(0,4),10),m=parseInt(mon.slice(5),10);
  var first=new Date(y,m-1,1), lead=(first.getDay()+6)%7, dim=new Date(y,m,0).getDate();
  var tr=document.createElement("tr"), cells=0, made=0;
  function blank(){{var td=document.createElement("td");td.innerHTML="<span class='cd'></span>";tr.appendChild(td);cells++;}}
  for(var k=0;k<lead;k++) blank();
  for(var day=1;day<=dim;day++){{
    var iso=mon+"-"+(day<10?"0":"")+day;
    var info=DATA.days[iso];
    var td=document.createElement("td");
    if(info){{
      var lv=info.l||0;
      var bg=lv?("rgba(201,169,110,"+(0.14+lv*0.13).toFixed(2)+")"):"rgba(201,169,110,.10)";
      var cls="cd has"+(iso===DATA.today?" today":"");
      td.innerHTML="<a class='"+cls+"' href='#"+iso+"' style='background:"+bg+"' title='"+(info.o||"").replace(/['"<>&]/g,"")+"'>"+
                   day+"<u>"+("●".repeat(Math.min(lv,3))||"·")+"</u></a>";
      made++;
    }} else {{
      td.innerHTML="<span class='cd'>"+day+"</span>";
    }}
    tr.appendChild(td); cells++;
    if(cells%7===0){{cb.appendChild(tr);tr=document.createElement("tr");}}
  }}
  while(cells%7!==0) blank();
  if(tr.children.length) cb.appendChild(tr);
  cnote.textContent=made?("本月 "+made+" 天 · 底色越深情绪强度越高 · ● 为强度"+(DATA.latest==null?"":" · 最新 "+DATA.latest)):"本月还没有日记";
}}

mp.addEventListener("click",function(){{var i=DATA.months.indexOf(curMon);if(i>0)drawCal(DATA.months[i-1]);}});
mn.addEventListener("click",function(){{var i=DATA.months.indexOf(curMon);if(i>=0&&i<DATA.months.length-1)drawCal(DATA.months[i+1]);}});
ms.addEventListener("change",function(){{drawCal(ms.value);}});

/* 点日历格子 → 回到列表并高亮那一天 */
cb.addEventListener("click",function(e){{
  var a=e.target.closest?e.target.closest("a.cd"):null;
  if(!a) return;
  e.preventDefault();
  var id=a.getAttribute("href").slice(1);
  setView("list");
  var card=document.getElementById(id);
  if(card){{
    cards.forEach(function(c){{c.classList.remove("hl");}});
    card.classList.add("hl");
    card.scrollIntoView({{behavior:"smooth",block:"start"}});
    setTimeout(function(){{card.classList.remove("hl");}},2600);
  }}
}});

/* 初次进入：恢复上次视图；有锚点则高亮 */
setView(localStorage.getItem("diary_view")||"list");
if(location.hash){{
  var c=document.getElementById(location.hash.slice(1));
  if(c) setTimeout(function(){{c.scrollIntoView({{block:"start"}});c.classList.add("hl");
    setTimeout(function(){{c.classList.remove("hl");}},2600);}},120);
}}
</script></body></html>'''


def main():
    items = [parse(p) for p in sorted(glob.glob(f"{EDIR}/*.md"))]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(render(items))
    print(f"生成 {OUT}：{len(items)} 天，{os.path.getsize(OUT)} 字节")


if __name__ == "__main__":
    main()
