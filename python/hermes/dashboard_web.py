from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import json
import yaml
import math
from pathlib import Path

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATE_DIR = Path("/app/state")

def load_trades():
    f = STATE_DIR / "trades.jsonl"
    if not f.exists(): return []
    return [json.loads(l) for l in open(f) if l.strip()]

def load_heartbeat():
    f = STATE_DIR / "heartbeat.json"
    if not f.exists(): return {}
    return json.load(open(f))

def load_strategy():
    f = STATE_DIR / "strategy.yaml"
    if not f.exists(): return {"version": "01", "assets": {}}
    return yaml.safe_load(open(f))

def save_strategy(strategy):
    f = STATE_DIR / "strategy.yaml"
    with open(f, "w") as file:
        yaml.dump(strategy, file, default_flow_style=False)

def load_goal():
    f = STATE_DIR / "goal.yaml"
    if not f.exists(): return {}
    return yaml.safe_load(open(f))

def save_goal(goal):
    f = STATE_DIR / "goal.yaml"
    with open(f, "w") as file:
        yaml.dump(goal, file, default_flow_style=False)

def save_heartbeat(heartbeat):
    f = STATE_DIR / "heartbeat.json"
    with open(f, "w") as file:
        json.dump(heartbeat, file, indent=2)

def calc_stats(trades):
    if not trades:
        return {"total_trades": 0, "win_rate": 0, "total_pnl": 0, "sharpe": 0, "max_drawdown": 0}
    pnls = [t.get("pnl_pct", 0) for t in trades]
    winners = [p for p in pnls if p > 0]
    total_pnl = sum(pnls)
    win_rate = len(winners)/len(trades)*100 if trades else 0
    cumulative = 0
    peak = 0
    max_dd = 0
    for p in pnls:
        cumulative += p
        peak = max(peak, cumulative)
        max_dd = max(max_dd, peak - cumulative)
    if len(pnls) > 1:
        mean_ret = sum(pnls) / len(pnls)
        variance = sum((r - mean_ret) ** 2 for r in pnls) / (len(pnls) - 1)
        std_dev = math.sqrt(variance) if variance > 0 else 0.0001
        sharpe = (mean_ret / std_dev) * math.sqrt(252)
    else:
        sharpe = 0
    return {"total_trades": len(trades), "win_rate": round(win_rate, 1), "total_pnl": round(total_pnl, 2), "sharpe": round(sharpe, 2), "max_drawdown": round(max_dd, 2)}

@app.get("/api/status")
def status():
    h = load_heartbeat()
    s = load_strategy()
    return {"status": "online" if h else "offline", "assets": h.get("assets", []), "positions": h.get("positions", []), "volatilities": h.get("volatilities", {}), "position_sizes": h.get("position_sizes", {}), "strategy_version": s.get("version", "?")}

@app.get("/api/stats")
def stats():
    return calc_stats(load_trades())

@app.get("/api/trades")
def trades():
    return load_trades()[-20:][::-1]

@app.get("/api/equity")
def equity():
    trades = load_trades()
    eq = [100]
    for t in trades:
        eq.append(round(eq[-1] * (1 + t.get("pnl_pct", 0)/100), 2))
    return {"equity": eq}

@app.get("/api/strategy")
def get_strategy():
    return load_strategy()

@app.post("/api/strategy")
async def update_strategy(request: Request):
    data = await request.json()
    strategy = load_strategy()
    for asset, settings in data.get("assets", {}).items():
        if asset not in strategy.get("assets", {}):
            strategy.setdefault("assets", {})[asset] = {"entry": {"indicator": "rsi", "threshold": 30, "direction": "long"}, "stop_loss_pct": 2.0, "position_size_r": 0.33}
        if "threshold" in settings:
            strategy["assets"][asset].setdefault("entry", {})["threshold"] = settings["threshold"]
        if "stop_loss_pct" in settings:
            strategy["assets"][asset]["stop_loss_pct"] = settings["stop_loss_pct"]
    save_strategy(strategy)
    return {"success": True, "strategy": strategy}

@app.post("/api/asset/add")
async def add_asset(request: Request):
    data = await request.json()
    symbol = data.get("symbol", "").upper()
    if not symbol:
        return {"success": False, "error": "No symbol provided"}
    if "/" not in symbol:
        symbol = symbol + "/USD"
    strategy = load_strategy()
    heartbeat = load_heartbeat()
    goal = load_goal()
    if symbol not in strategy.get("assets", {}):
        strategy.setdefault("assets", {})[symbol] = {
            "entry": {"indicator": "rsi", "threshold": data.get("threshold", 30), "direction": "long"},
            "stop_loss_pct": data.get("stop_loss_pct", 2.0),
            "position_size_r": 0.25
        }
        save_strategy(strategy)
    if symbol not in heartbeat.get("assets", []):
        heartbeat.setdefault("assets", []).append(symbol)
        heartbeat.setdefault("volatilities", {})[symbol] = 0.5
        heartbeat.setdefault("position_sizes", {})[symbol] = 0.25
        save_heartbeat(heartbeat)
    if "assets" in goal:
        if not any(a.get("symbol") == symbol for a in goal["assets"]):
            goal["assets"].append({"symbol": symbol, "target_return_30d": 0.05, "max_drawdown": 0.08, "min_sharpe": 1.2})
            save_goal(goal)
    return {"success": True, "symbol": symbol}

@app.post("/api/asset/remove")
async def remove_asset(request: Request):
    data = await request.json()
    symbol = data.get("symbol", "")
    if not symbol:
        return {"success": False, "error": "No symbol provided"}
    strategy = load_strategy()
    heartbeat = load_heartbeat()
    goal = load_goal()
    if symbol in strategy.get("assets", {}):
        del strategy["assets"][symbol]
        save_strategy(strategy)
    if symbol in heartbeat.get("assets", []):
        heartbeat["assets"].remove(symbol)
        if symbol in heartbeat.get("volatilities", {}):
            del heartbeat["volatilities"][symbol]
        if symbol in heartbeat.get("position_sizes", {}):
            del heartbeat["position_sizes"][symbol]
        save_heartbeat(heartbeat)
    if "assets" in goal:
        goal["assets"] = [a for a in goal["assets"] if a.get("symbol") != symbol]
        save_goal(goal)
    return {"success": True, "symbol": symbol}

@app.get("/api/goal")
def get_goal():
    return load_goal()

@app.post("/api/goal")
async def update_goal(request: Request):
    data = await request.json()
    goal = load_goal()
    if "target_return_30d" in data:
        goal["target_return_30d"] = data["target_return_30d"]
    if "max_drawdown" in data:
        goal["max_drawdown"] = data["max_drawdown"]
    if "min_sharpe" in data:
        goal["min_sharpe"] = data["min_sharpe"]
    save_goal(goal)
    return {"success": True, "goal": goal}

@app.get("/", response_class=HTMLResponse)
def home():
    return '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hermes Trading Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        .card { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); }
        .glow { box-shadow: 0 0 20px rgba(99, 102, 241, 0.3); }
        input[type="number"], input[type="text"] { background: #1f2937; border: 1px solid #374151; color: white; padding: 0.5rem; border-radius: 0.375rem; }
        input[type="number"] { width: 80px; }
        input[type="text"] { width: 120px; }
        input:focus { outline: none; border-color: #818cf8; }
        .btn { padding: 0.5rem 1rem; border-radius: 0.375rem; font-weight: 600; cursor: pointer; }
        .btn-indigo { background: #4f46e5; }
        .btn-indigo:hover { background: #4338ca; }
        .btn-purple { background: #7c3aed; }
        .btn-purple:hover { background: #6d28d9; }
        .btn-green { background: #059669; }
        .btn-green:hover { background: #047857; }
        .btn-red { background: #dc2626; }
        .btn-red:hover { background: #b91c1c; }
    </style>
</head>
<body class="bg-gray-900 text-white min-h-screen p-6">
    <div class="max-w-7xl mx-auto">
        <header class="mb-8">
            <h1 class="text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent">&#128640; Hermes Trading</h1>
            <p class="text-gray-400 mt-2">Self-improving multi-asset trading agent</p>
        </header>
        <div id="status-bar" class="card rounded-xl p-4 mb-6 glow">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div id="status-dot" class="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                    <span id="status-text" class="text-lg">Loading...</span>
                </div>
                <div class="text-gray-400 text-sm">Strategy <span id="strategy-version" class="text-indigo-400">v?</span></div>
            </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="card rounded-xl p-4">
                <div class="text-gray-400 text-sm">Total P&L</div>
                <div id="total-pnl" class="text-2xl font-bold text-green-400">+0.00%</div>
            </div>
            <div class="card rounded-xl p-4">
                <div class="text-gray-400 text-sm">Win Rate</div>
                <div id="win-rate" class="text-2xl font-bold text-indigo-400">0%</div>
            </div>
            <div class="card rounded-xl p-4">
                <div class="text-gray-400 text-sm">Sharpe Ratio</div>
                <div id="sharpe" class="text-2xl font-bold text-purple-400">0.00</div>
            </div>
            <div class="card rounded-xl p-4">
                <div class="text-gray-400 text-sm">Max Drawdown</div>
                <div id="max-dd" class="text-2xl font-bold text-red-400">0.00%</div>
            </div>
        </div>
        <div class="grid md:grid-cols-2 gap-6 mb-6">
            <div class="card rounded-xl p-6">
                <h2 class="text-xl font-semibold mb-4">&#128202; Current Positions</h2>
                <div id="positions"><p class="text-gray-400">No open positions</p></div>
            </div>
            <div class="card rounded-xl p-6">
                <h2 class="text-xl font-semibold mb-4">&#9878; Position Sizing</h2>
                <div id="sizing"><p class="text-gray-400">Loading...</p></div>
            </div>
        </div>
        <div class="card rounded-xl p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">&#128200; Equity Curve</h2>
            <canvas id="equity-chart" height="100"></canvas>
        </div>
        <div class="card rounded-xl p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">&#128176; Manage Assets</h2>
            <div class="flex gap-4 items-end mb-4">
                <div>
                    <label class="text-gray-400 text-sm block mb-1">Symbol</label>
                    <input type="text" id="new-symbol" placeholder="SPY, QQQ, BTC..." class="w-32">
                </div>
                <div>
                    <label class="text-gray-400 text-sm block mb-1">RSI Threshold</label>
                    <input type="number" id="new-threshold" value="30" min="1" max="99">
                </div>
                <div>
                    <label class="text-gray-400 text-sm block mb-1">Stop Loss %</label>
                    <input type="number" id="new-stoploss" value="2" min="0.1" max="20" step="0.1">
                </div>
                <button onclick="addAsset()" class="btn btn-green">+ Add Asset</button>
            </div>
            <div id="asset-list" class="space-y-2"></div>
            <span id="asset-status" class="text-green-400"></span>
        </div>
        <div class="card rounded-xl p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">&#9881; Strategy Settings</h2>
            <div id="settings" class="space-y-4"></div>
            <button onclick="saveStrategy()" class="mt-4 btn btn-indigo">Save Strategy</button>
            <span id="save-status" class="ml-4 text-green-400"></span>
        </div>
        <div class="card rounded-xl p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">&#127919; Goal Settings</h2>
            <div class="grid grid-cols-3 gap-4">
                <div>
                    <label class="text-gray-400 text-sm">Target Return (30d)</label>
                    <div class="flex items-center gap-2">
                        <input type="number" id="target-return" step="1" min="1" max="100" class="w-24"> <span class="text-gray-400">%</span>
                    </div>
                </div>
                <div>
                    <label class="text-gray-400 text-sm">Max Drawdown</label>
                    <div class="flex items-center gap-2">
                        <input type="number" id="max-drawdown" step="1" min="1" max="100" class="w-24"> <span class="text-gray-400">%</span>
                    </div>
                </div>
                <div>
                    <label class="text-gray-400 text-sm">Min Sharpe</label>
                    <input type="number" id="min-sharpe" step="0.1" min="0" max="5" class="w-24">
                </div>
            </div>
            <button onclick="saveGoal()" class="mt-4 btn btn-purple">Save Goals</button>
            <span id="goal-status" class="ml-4 text-green-400"></span>
        </div>
        <div class="card rounded-xl p-6">
            <h2 class="text-xl font-semibold mb-4">&#128260; Recent Trades</h2>
            <div id="trades" class="space-y-2 max-h-96 overflow-y-auto"><p class="text-gray-400">No trades yet</p></div>
        </div>
    </div>
    <script>
        let chart;
        let currentStrategy = {};
        let currentAssets = [];
        
        async function load() {
            try {
                const [status, stats, trades, equity, strategy, goal] = await Promise.all([
                    fetch("/api/status").then(r => r.json()),
                    fetch("/api/stats").then(r => r.json()),
                    fetch("/api/trades").then(r => r.json()),
                    fetch("/api/equity").then(r => r.json()),
                    fetch("/api/strategy").then(r => r.json()),
                    fetch("/api/goal").then(r => r.json())
                ]);
                
                currentStrategy = strategy;
                currentAssets = status.assets || [];
                
                document.getElementById("status-text").textContent = status.status === "online" ? "Online - " + currentAssets.join(", ") : "Offline";
                document.getElementById("status-dot").className = "w-3 h-3 rounded-full " + (status.status === "online" ? "bg-green-500 animate-pulse" : "bg-red-500");
                document.getElementById("strategy-version").textContent = "v" + status.strategy_version;
                
                const pnlEl = document.getElementById("total-pnl");
                pnlEl.textContent = (stats.total_pnl >= 0 ? "+" : "") + stats.total_pnl.toFixed(2) + "%";
                pnlEl.className = "text-2xl font-bold " + (stats.total_pnl >= 0 ? "text-green-400" : "text-red-400");
                document.getElementById("win-rate").textContent = stats.win_rate + "%";
                document.getElementById("sharpe").textContent = stats.sharpe.toFixed(2);
                document.getElementById("max-dd").textContent = stats.max_drawdown.toFixed(2) + "%";
                
                const posEl = document.getElementById("positions");
                posEl.innerHTML = (status.positions && status.positions.length > 0) ? status.positions.map(p => "<div class=\\"flex justify-between p-2 bg-gray-800 rounded\\"><span class=\\"text-indigo-400\\">" + p + "</span><span class=\\"text-green-400\\">LONG</span></div>").join("") : "<p class=\\"text-gray-400\\">No open positions</p>";
                
                const sizEl = document.getElementById("sizing");
                const sizes = status.position_sizes || {};
                const vols = status.volatilities || {};
                sizEl.innerHTML = Object.keys(sizes).length > 0 ? Object.keys(sizes).map(k => "<div class=\\"flex justify-between p-2 bg-gray-800 rounded\\"><span>" + k + "</span><span class=\\"text-indigo-400\\">" + (sizes[k]*100).toFixed(1) + "%</span><span class=\\"text-gray-400\\">vol: " + (vols[k] || 0).toFixed(2) + "%</span></div>").join("") : "<p class=\\"text-gray-400\\">No data</p>";
                
                // Asset list with remove buttons
                const assetListEl = document.getElementById("asset-list");
                assetListEl.innerHTML = currentAssets.map(a => "<div class=\\"flex justify-between items-center p-2 bg-gray-800 rounded\\"><span class=\\"text-indigo-400\\">" + a + "</span><button onclick=\\"removeAsset('" + a + "')\\" class=\\"btn btn-red text-sm py-1 px-2\\">Remove</button></div>").join("");
                
                // Strategy settings
                const settingsEl = document.getElementById("settings");
                const assets = strategy.assets || {};
                settingsEl.innerHTML = Object.keys(assets).map(asset => {
                    const a = assets[asset];
                    const threshold = a.entry?.threshold || 30;
                    const stopLoss = a.stop_loss_pct || 2;
                    return "<div class=\\"p-3 bg-gray-800 rounded-lg\\"><div class=\\"font-semibold text-indigo-400 mb-2\\">" + asset + "</div><div class=\\"grid grid-cols-2 gap-4\\"><div><label class=\\"text-gray-400 text-sm\\">RSI Threshold</label><input type=\\"number\\" id=\\"threshold-" + asset.replace("/", "-") + "\\" value=\\"" + threshold + "\\" min=\\"1\\" max=\\"99\\" class=\\"w-20\\"></div><div><label class=\\"text-gray-400 text-sm\\">Stop Loss %</label><input type=\\"number\\" id=\\"stoploss-" + asset.replace("/", "-") + "\\" value=\\"" + stopLoss + "\\" min=\\"0.1\\" max=\\"20\\" step=\\"0.1\\" class=\\"w-20\\"></div></div></div>";
                }).join("");
                
                // Goal settings
                document.getElementById("target-return").value = ((goal.target_return_30d || 0.05) * 100).toFixed(0);
                document.getElementById("max-drawdown").value = ((goal.max_drawdown || 0.08) * 100).toFixed(0);
                document.getElementById("min-sharpe").value = goal.min_sharpe || 1.2;
                
                // Trades
                const trEl = document.getElementById("trades");
                trEl.innerHTML = trades.length > 0 ? trades.map(t => "<div class=\\"flex justify-between p-2 bg-gray-800 rounded\\"><span class=\\"text-gray-400\\">" + (t.exit_time || "").slice(0,10) + "</span><span>" + t.asset + "</span><span class=\\"" + (t.pnl_pct >= 0 ? "text-green-400" : "text-red-400") + "\\">" + (t.pnl_pct >= 0 ? "+" : "") + t.pnl_pct.toFixed(2) + "%</span></div>").join("") : "<p class=\\"text-gray-400\\">No trades yet</p>";
                
                // Chart
                const ctx = document.getElementById("equity-chart").getContext("2d");
                if (chart) { chart.data.labels = equity.equity.map((_, i) => i); chart.data.datasets[0].data = equity.equity; chart.update(); }
                else { chart = new Chart(ctx, { type: "line", data: { labels: equity.equity.map((_, i) => i), datasets: [{ label: "Equity", data: equity.equity, borderColor: "#818cf8", backgroundColor: "rgba(129, 140, 248, 0.1)", fill: true, tension: 0.4 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: "rgba(255,255,255,0.1)" }, ticks: { color: "#9ca3af" } } } } }); }
            } catch (e) { console.error(e); }
        }
        
        async function addAsset() {
            const symbol = document.getElementById("new-symbol").value.trim();
            const threshold = parseFloat(document.getElementById("new-threshold").value);
            const stopLoss = parseFloat(document.getElementById("new-stoploss").value);
            if (!symbol) { alert("Enter a symbol"); return; }
            const res = await fetch("/api/asset/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, threshold, stop_loss_pct: stopLoss }) });
            if (res.ok) {
                document.getElementById("new-symbol").value = "";
                document.getElementById("asset-status").textContent = "Added " + symbol + "!";
                setTimeout(() => document.getElementById("asset-status").textContent = "", 3000);
                load();
            }
        }
        
        async function removeAsset(symbol) {
            if (!confirm("Remove " + symbol + "?")) return;
            const res = await fetch("/api/asset/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }) });
            if (res.ok) {
                document.getElementById("asset-status").textContent = "Removed " + symbol + "!";
                setTimeout(() => document.getElementById("asset-status").textContent = "", 3000);
                load();
            }
        }
        
        async function saveStrategy() {
            const assets = currentStrategy.assets || {};
            const updates = { assets: {} };
            for (const asset of Object.keys(assets)) {
                const safeId = asset.replace("/", "-");
                const threshold = document.getElementById("threshold-" + safeId)?.value;
                const stopLoss = document.getElementById("stoploss-" + safeId)?.value;
                if (threshold || stopLoss) {
                    updates.assets[asset] = {};
                    if (threshold) updates.assets[asset].threshold = parseFloat(threshold);
                    if (stopLoss) updates.assets[asset].stop_loss_pct = parseFloat(stopLoss);
                }
            }
            const res = await fetch("/api/strategy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
            if (res.ok) {
                document.getElementById("save-status").textContent = "Saved!";
                setTimeout(() => document.getElementById("save-status").textContent = "", 3000);
            }
        }
        
        async function saveGoal() {
            const updates = {
                target_return_30d: parseFloat(document.getElementById("target-return").value) / 100,
                max_drawdown: parseFloat(document.getElementById("max-drawdown").value) / 100,
                min_sharpe: parseFloat(document.getElementById("min-sharpe").value)
            };
            const res = await fetch("/api/goal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
            if (res.ok) {
                document.getElementById("goal-status").textContent = "Saved!";
                setTimeout(() => document.getElementById("goal-status").textContent = "", 3000);
            }
        }
        
        load();
        setInterval(load, 30000);
    </script>
</body>
</html>'''

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
