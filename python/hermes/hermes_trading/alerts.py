import httpx
import json
from datetime import datetime, timezone

TELEGRAM_BOT_TOKEN = "8356594166:AAE3ySWm-S1mLViVe60A7XobSGAkEgEMhbM"
TELEGRAM_CHAT_ID = "7258683688"
DISCORD_WEBHOOK_URL = ""  # Add later if you want Discord too

async def send_telegram(message: str):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML"
    }
    async with httpx.AsyncClient() as client:
        try:
            await client.post(url, json=payload, timeout=10)
        except Exception as e:
            print(f"Telegram error: {e}")

async def send_discord(message: str):
    if not DISCORD_WEBHOOK_URL:
        return
    payload = {"content": message}
    async with httpx.AsyncClient() as client:
        try:
            await client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        except Exception as e:
            print(f"Discord error: {e}")

async def alert(message: str):
    await send_telegram(message)
    await send_discord(message)

async def alert_trade_opened(asset: str, direction: str, entry_price: float, rsi: float):
    msg = f"?? <b>TRADE OPENED</b>\n\n"
    msg += f"Asset: {asset}\n"
    msg += f"Direction: {direction.upper()}\n"
    msg += f"Entry: \\n"
    msg += f"RSI: {rsi:.1f}"
    await alert(msg)

async def alert_trade_closed(asset: str, direction: str, entry_price: float, exit_price: float, pnl_pct: float):
    emoji = "??" if pnl_pct > 0 else "??"
    msg = f"{emoji} <b>TRADE CLOSED</b>\n\n"
    msg += f"Asset: {asset}\n"
    msg += f"Direction: {direction.upper()}\n"
    msg += f"Entry: \\n"
    msg += f"Exit: \\n"
    msg += f"P&L: {pnl_pct:+.2f}%"
    await alert(msg)

async def alert_strategy_updated(old_version: str, new_version: str, variable: str, old_val, new_val, reasoning: str):
    msg = f"?? <b>STRATEGY EVOLVED</b>\n\n"
    msg += f"Version: v{old_version} ? v{new_version}\n"
    msg += f"Changed: {variable}\n"
    msg += f"Value: {old_val} ? {new_val}\n"
    msg += f"Reason: {reasoning}"
    await alert(msg)

async def alert_error(error_type: str, details: str):
    msg = f"?? <b>ALERT</b>\n\n"
    msg += f"Type: {error_type}\n"
    msg += f"Details: {details}"
    await alert(msg)

async def alert_status(asset: str, price: float, rsi: float, position: bool):
    status = "IN POSITION" if position else "WATCHING"
    msg = f"?? <b>STATUS UPDATE</b>\n\n"
    msg += f"Asset: {asset}\n"
    msg += f"Price: \\n"
    msg += f"RSI: {rsi:.1f}\n"
    msg += f"Status: {status}"
    await alert(msg)
