<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pledge Manager Wireframe v0.1.0</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f4f4f4; color: #222; }
    .topbar { background: #1f2937; color: #fff; padding: 12px 18px; display:flex; justify-content:space-between; align-items:center; }
    .wrap { padding: 16px; }
    .row { display:flex; gap:16px; margin-bottom:16px; }
    .card { background:#fff; border:1px solid #cfcfcf; border-radius:8px; padding:12px; box-shadow:0 1px 2px rgba(0,0,0,.06); }
    .left { flex: 3; }
    .right { flex: 2; }
    .btns { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
    .btn { background:#e5e7eb; border:1px solid #c7cad1; padding:8px 10px; border-radius:6px; }
    .grid { width:100%; border-collapse:collapse; table-layout:fixed; font-size:12px; }
    .grid th, .grid td { border:1px solid #d7d7d7; padding:6px; vertical-align:top; height:42px; }
    .time { width:68px; background:#fafafa; font-weight:bold; }
    .dayhdr { background:#eef3f8; text-align:center; font-weight:bold; }
    .slot { position:relative; }
    .block { background:#d7e8ff; border:1px solid #89aee6; border-radius:6px; padding:6px; font-size:11px; }
    .block.live { background:#ffd9d9; border-color:#e38585; }
    .small { font-size:12px; color:#555; }
    .runlist { width:100%; border-collapse:collapse; font-size:12px; }
    .runlist th, .runlist td { border:1px solid #d7d7d7; padding:6px; }
    .tag { display:inline-block; padding:2px 6px; border:1px solid #999; border-radius:10px; font-size:11px; margin-left:6px; }
    .tag.arch { background:#f3f3f3; }
    .searchbox { border:1px solid #bbb; border-radius:6px; padding:8px; margin:8px 0; background:#fafafa; }
</style>
</head>
<body>
<div class="topbar">
    <div><strong>Pledge Manager</strong> — Wireframe</div>
    <div>Version v0.1.0</div>
</div>

<div class="wrap">
    <div class="row">
        <div class="card left">
            <h2 style="margin-top:0;">Fundraiser: Spring 2026 Pledge</h2>
            <div class="small">Dates: Feb 28, 2026 – Mar 18, 2026 · Dayparts: Daytime / Evening / Late Night · Status: Active</div>
            <div class="btns">
                <div class="btn">Create Fundraiser</div>
                <div class="btn">Duplicate Fundraiser</div>
                <div class="btn">Import Results Report</div>
                <div class="btn">Export Schedule</div>
                <div class="btn">Review Queue</div>
            </div>
        </div>
        <div class="card right">
            <h3 style="margin-top:0;">Quick Totals</h3>
            <div class="small">Scheduled airings: 42</div>
            <div class="small">Live blocks: 4</div>
            <div class="small">Total raised: $9,837</div>
            <div class="small">Rows needing review: 3</div>
        </div>
    </div>

    <div class="row">
        <div class="card left">
            <h3 style="margin-top:0;">Schedule Board</h3>
            <div class="small">Primary flow: click a slot, type title, choose match, block appears automatically.</div>
            <div class="searchbox">
                Add at <strong>Thu Mar 12 · 8:00 PM</strong><br>
                Type title, alias, or NOLA: <strong>all crea…</strong><br>
                Suggestions:
                <ul>
                    <li>ALL CREATURES GREAT AND SMALL — HDPE — 90 min — Avg $1,734</li>
                    <li>ALL CREATURES GREAT AND SMALL — HDPL — 90 min — Avg $1,200</li>
                    <li>ALL CREATURES ARCHIVE SPECIAL — 90 min <span class="tag arch">Archived</span></li>
                </ul>
            </div>
            <table class="grid">
                <tr>
                    <th class="time">Time</th>
                    <th class="dayhdr">Thu 3/12</th>
                    <th class="dayhdr">Fri 3/13</th>
                    <th class="dayhdr">Sat 3/14</th>
                    <th class="dayhdr">Sun 3/15</th>
                </tr>
                <tr>
                    <td class="time">7:00 PM</td>
                    <td class="slot"></td>
                    <td class="slot"></td>
                    <td class="slot"><div class="block live">LIVE Pledge<br>7:00–10:00 PM</div></td>
                    <td class="slot"></td>
                </tr>
                <tr>
                    <td class="time">7:30 PM</td>
                    <td class="slot"><div class="block">LAWRENCE WELK<br>7:30–9:30 PM</div></td>
                    <td class="slot"></td>
                    <td class="slot"></td>
                    <td class="slot"></td>
                </tr>
                <tr>
                    <td class="time">8:00 PM</td>
                    <td class="slot"></td>
                    <td class="slot"><div class="block">ALL CREATURES GREAT AND SMALL<br>8:00–9:30 PM</div></td>
                    <td class="slot"></td>
                    <td class="slot"><div class="block">BARRY MANILOW<br>8:00–9:30 PM</div></td>
                </tr>
                <tr>
                    <td class="time">8:30 PM</td>
                    <td class="slot"></td>
                    <td class="slot"></td>
                    <td class="slot"></td>
                    <td class="slot"></td>
                </tr>
            </table>
        </div>

        <div class="card right">
            <h3 style="margin-top:0;">Selected Airing</h3>
            <div><strong>ALL CREATURES GREAT AND SMALL</strong></div>
            <div class="small">Version: HDPE · Board runtime: 90 · Exact runtime: 1:28:15</div>
            <div class="small">NOLA: ACSD · Distributor: PBS</div>
            <div class="small">Premiums: 5-disc set</div>
            <div class="small">Break summary: 5 breaks · 2 local</div>
            <div class="small">Break signature: P26 F2[L] P21 F2[L] P19</div>
            <div class="small">Avg dollars: $1,734 · Lifetime: $8,214</div>
        </div>
    </div>

    <div class="card">
        <h3 style="margin-top:0;">Run List / Handoff</h3>
        <table class="runlist">
            <tr>
                <th>Date</th>
                <th>Start</th>
                <th>End</th>
                <th>Title</th>
                <th>Ver</th>
                <th>NOLA</th>
                <th>Board</th>
                <th>Exact</th>
                <th>Break Summary</th>
                <th>Premiums</th>
                <th>Avg $</th>
                <th>Drive $</th>
            </tr>
            <tr>
                <td>2026-03-13</td>
                <td>8:00 PM</td>
                <td>9:30 PM</td>
                <td>ALL CREATURES GREAT AND SMALL</td>
                <td>HDPE</td>
                <td>ACSD</td>
                <td>90</td>
                <td>1:28:15</td>
                <td>5 breaks · 2 local</td>
                <td>5-disc set</td>
                <td>1,734</td>
                <td>1,734</td>
            </tr>
        </table>
    </div>
</div>
</body>
</html>
