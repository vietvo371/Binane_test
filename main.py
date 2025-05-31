import requests
import json
import time
from uuid import uuid4
import urllib.parse
import threading
import asyncio
from math import log10, floor, ceil
from datetime import datetime
import gzip
import io
from collections import defaultdict
import os
import hmac
import hashlib
from dotenv import load_dotenv
from datetime import datetime
import ssl
import websockets
import orjson
import time

load_dotenv()

SYMBOL = "ALCH"
SO_COIN_DANH = 50.0  # Số lượng coin cần đặt lệnh
SHARE_PRICE = {
    "gia_mua_gate": None,  # Giá ask từ orderbook (màu đỏ)
    "time_gia_gate": None,
    "orderbook_ready": False
}

ORDER_PLACED = False
AUTHENTICATED = False
LAST_PRICE_PRINT = 0

async def start_gateio_orderbook_ws(gateIOAccount):
    """Kết nối WebSocket Gate.io để lấy orderbook"""
    global SHARE_PRICE, ORDER_PLACED, AUTHENTICATED, LAST_PRICE_PRINT
    pair = SYMBOL + "_USDT"
    ws_url = "wss://api.gateio.ws/ws/v4/"
    
    async with websockets.connect(ws_url) as websocket:
        print(f'📡 Connecting to Gate.io orderbook for {pair}...')
        subscribe_msg = {
            "time": int(time.time()),
            "channel": "spot.book_ticker",
            "event": "subscribe",
            "payload": [pair]
        }
        await websocket.send(orjson.dumps(subscribe_msg))
        print(f'✅ Subscribed to Gate.io orderbook for {pair}')

        while True:
            try:
                message = await websocket.recv()
                data = orjson.loads(message)
                
                if data.get("channel") != "spot.book_ticker" or data.get("event") != "update":
                    continue
                
                result = data.get("result", {})
                if result.get("s") != pair:
                    continue
                
                # Lấy giá ask (màu đỏ) - giá người bán đưa ra
                best_ask = float(result.get("a", 0))
                old_price = SHARE_PRICE.get("gia_mua_gate")
                SHARE_PRICE["gia_mua_gate"] = best_ask
                SHARE_PRICE["time_gia_gate"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
                SHARE_PRICE["orderbook_ready"] = True
                
                # Chỉ in khi có thay đổi đáng kể hoặc mỗi 5 giây
                current_time = time.time()
                should_print = (
                    old_price is None or 
                    abs(best_ask - old_price) > 0.001 or 
                    current_time - LAST_PRICE_PRINT > 5
                )
                
                if should_print:
                    print(f"📊 Orderbook updated - Ask price: {best_ask}")
                    LAST_PRICE_PRINT = current_time
                
                # Chỉ đặt lệnh 1 lần khi có giá, đã authentication và chưa đặt lệnh
                if not ORDER_PLACED and best_ask > 0 and AUTHENTICATED:
                    ORDER_PLACED = True
                    print(f"⏰ Waiting 10 seconds before placing order...")
                    await asyncio.sleep(10)  # Chờ 10 giây
                    
                    # Đặt lệnh mua
                    await gateIOAccount.create_order(
                        side="BUY",
                        symbol=SYMBOL.lower() + "_usdt",
                        quantity=SO_COIN_DANH,
                        price=best_ask,
                        type="limit",
                        time_in_force="fok"
                    )
                elif not ORDER_PLACED:
                    # Debug: In trạng thái tại sao chưa đặt lệnh
                    if should_print:  # Chỉ debug 1 lần mỗi 5 giây
                        if best_ask <= 0:
                            print(f"⚠️ Not placing order: Invalid price {best_ask}")
                        elif not AUTHENTICATED:
                            print(f"⚠️ Not placing order: Not authenticated yet (AUTHENTICATED={AUTHENTICATED})")
                        else:
                            print(f"⚠️ Not placing order: Unknown reason (price={best_ask}, auth={AUTHENTICATED})")

            except Exception as e:
                print(f"❌ Error parsing orderbook message: {e}")
                await asyncio.sleep(1)

class GateIOAccount:
    def __init__(self, api_key, api_secret, account_name):
        self.api_key = api_key
        self.api_secret = api_secret
        self.account_name = account_name
        self.sent_time_map = {}
        self.response_count = {}  # Đếm số lần phản hồi cho mỗi req_id
        self.response_times = {}  # Lưu thời gian từng phản hồi
        self.ws_url = "wss://api.gateio.ws/ws/v4/"
        self.websocket = None
        self.authenticated = False
        self.running = True

    def get_ts(self):
        return int(time.time())

    def get_ts_ms(self):
        return int(time.time() * 1000)

    def create_signature(self, channel, request_param_bytes, ts):
        # Gate.io signature format: "api\n{channel}\n{request_param}\n{timestamp}"
        request_param_str = request_param_bytes.decode('utf-8') if request_param_bytes else ""
        sign_string = f"api\n{channel}\n{request_param_str}\n{ts}"
        
        signature = hmac.new(
            self.api_secret.encode('utf-8'),
            sign_string.encode('utf-8'),
            hashlib.sha512
        ).hexdigest()
        
        print(f"   🔧 Sign string: {repr(sign_string)}")
        return signature

    async def authenticate(self, websocket):
        timestamp = self.get_ts()
        req_id = f"auth-{self.get_ts_ms()}"
        request_param = b""
        
    
        
        signature = self.create_signature("spot.login", request_param, timestamp)
        print(f"   ✍️ Signature: {signature[:20]}...")
        
        auth_request = {
            "time": timestamp,
            "channel": "spot.login",
            "event": "api",
            "payload": {
                "api_key": self.api_key,
                "signature": signature,
                "timestamp": str(timestamp),
                "req_id": req_id
            }
        }
        
        try:
            payload_json = orjson.dumps(auth_request)
            print(f"   📦 Auth payload: {payload_json.decode()[:150]}...")
            await websocket.send(payload_json)
            print(f"   📤 Authentication request sent")
        except Exception as e:
            print(f"❌ [{self.account_name}] Failed to send auth request: {e}")

    async def send_ping(self, websocket):
        while self.running:
            try:
                ping_msg = {
                    "time": self.get_ts(),
                    "channel": "spot.ping"
                }
                await websocket.send(orjson.dumps(ping_msg))
                print(f"📡 [{self.account_name}] Ping sent")
                await asyncio.sleep(30)
            except:
                break

    async def create_order(self, side, symbol, quantity, price, type="limit", time_in_force="fok"):
        """Đặt lệnh và đo thời gian phản hồi"""
        if not self.authenticated or quantity <= 0 or price <= 0:
            print(f"❌ [{self.account_name}] Cannot place order - not authenticated or invalid params")
            return

        ts = int(time.time())
        ts_ms = int(time.time() * 1000)
        req_id = str(ts_ms)

        place_param = {
            "currency_pair": symbol,
            "side": side.lower(),
            "type": type.lower(),
            "amount": f"{quantity}",
            "price": f"{price}",
            "time_in_force": time_in_force.lower()
        }

        request = {
            "time": ts,
            "channel": "spot.order_place",
            "event": "api",
            "payload": {
                "req_id": req_id,
                "req_param": place_param
            }
        }

        # Lưu thời gian gửi lệnh
        send_time = time.perf_counter_ns()
        self.sent_time_map[req_id] = send_time
        self.response_count[req_id] = 0  # Đếm số phản hồi
        self.response_times[req_id] = {}  # Lưu thời gian từng phản hồi
        
        print(f"\n🚀 [{self.account_name}] Placing order: {side} {quantity} {symbol} @ {price}")
        print(f"🕒 Order sent at: {datetime.now().strftime('%H:%M:%S.%f')}")
        print(f"⏱ Starting latency measurement...")
        
        # Gửi lệnh
        payload_str = orjson.dumps(request)
        await self.websocket.send(payload_str)

    async def start_ws(self):
        """Khởi động WebSocket connection cho trading"""
        while self.running:
            try:
                print(f'🔌 Connecting to Gate.io WS for trading...')
                async with websockets.connect(self.ws_url) as websocket:
                    self.websocket = websocket
                    print(f'✅ [{self.account_name}] Connected to Gate.io WS')
                    
                    await self.authenticate(websocket)
                    asyncio.create_task(self.send_ping(websocket))
                    
                    while True:
                        try:
                            message = await websocket.recv()
                            await self.handle_message(message)
                        except websockets.exceptions.ConnectionClosed:
                            print(f"⚠️ [{self.account_name}] Connection closed. Reconnecting...")
                            break
                        except Exception as e:
                            print(f"❌ [{self.account_name}] Error handling message: {e}")
                            break

            except Exception as e:
                print(f"❌ [{self.account_name}] Connection error: {e}")
            
            if self.running:
                print(f"🔄 [{self.account_name}] Reconnecting in 3 seconds...")
                await asyncio.sleep(3)

    async def handle_message(self, message):
        """Xử lý phản hồi từ Gate.io và đo latency"""
        global AUTHENTICATED
        try:
            response = orjson.loads(message)
            received_time = time.perf_counter_ns()

            # Parse channel và event từ header hoặc root level
            header = response.get("header", {})
            channel = header.get("channel") or response.get("channel", "")
            event = header.get("event") or response.get("event", "")
            
            # Debug: In message đầy đủ cho authentication, ngắn gọn cho các message khác
            if channel == "spot.login" and event == "api":
                print(f"📨 [{self.account_name}] Full auth message: {message}")
            else:
                print(f"📨 [{self.account_name}] Received {channel}/{event}: {str(message)[:100]}...")

            # Xử lý authentication - Gate.io trả về với header format
            if channel == "spot.login" and event == "api":
                print(f"🔐 [{self.account_name}] Processing authentication response...")
                
                status = header.get("status") or response.get("status")
                
                print(f"   📊 Header: {header}")
                print(f"   📊 Status found: {status}")
                
                if status == "200":
                    # Check for UID in data.result
                    data = response.get("data", {})
                    result = data.get("result", {})
                    uid = result.get("uid", "unknown")
                    
                    print(f"✅ [{self.account_name}] Auth successful: Status {status}, UID {uid}")
                    self.authenticated = True
                    AUTHENTICATED = True
                    print(f"🎯 [{self.account_name}] AUTHENTICATED flag set to True")
                else:
                    error = header.get("message") or response.get("error") or f"Status: {status}"
                    print(f"❌ [{self.account_name}] Auth failed: {error}")
                return

            # Xử lý ping/pong response  
            if channel in ["spot.ping", "spot.pong"]:
                print(f"📡 [{self.account_name}] Ping/Pong response received")
                return

            # Xử lý phản hồi đặt lệnh
            if channel == "spot.order_place" and event == "api":
                print(f"📋 [{self.account_name}] Processing order response...")
                
                # Lấy req_id từ header hoặc payload
                req_id = header.get("request_id") or response.get("request_id") or response.get("payload", {}).get("req_id")
                
                if req_id and req_id in self.sent_time_map:
                    # Tính thời gian từ lúc gửi đến lúc nhận phản hồi
                    sent_time = self.sent_time_map[req_id]
                    latency_ns = received_time - sent_time
                    latency_ms = latency_ns / 1_000_000  # Convert ns to ms
                    
                    # Đếm số lần phản hồi
                    self.response_count[req_id] += 1
                    response_num = self.response_count[req_id]
                    
                    # Lưu thời gian phản hồi
                    self.response_times[req_id][f"response_{response_num}"] = latency_ms
                    
                    status = header.get("status") or response.get("status")
                    result = response.get("result", {})
                    if status == "201":
                        print(f"   ✅ Order success: {result}")
                    elif status == "400":
                        err_msg = header.get("message") or result.get("message", "Unknown error")
                        print(f"   ❌ Order rejected: {err_msg}")
                    else:
                        print(f"   📋 Response result: {result}")
                    
                    # Nếu là phản hồi cuối cùng hoặc có lỗi, in tổng kết
                    if response_num >= 2 or status in ["201", "400"]:
                        print(f"\n🏁 [{self.account_name}] Order processing completed!")
                        print(f"📊 LATENCY SUMMARY:")
                        
                        if "response_1" in self.response_times[req_id]:
                            print(f"   ⏱ Đặt lệnh → Response 1: {self.response_times[req_id]['response_1']:.2f} ms")
                        
                        if "response_2" in self.response_times[req_id]:
                            print(f"   ⏱ Đặt lệnh → Response 2: {self.response_times[req_id]['response_2']:.2f} ms")
                        
                        if response_num >= 2:
                            diff = self.response_times[req_id].get('response_2', 0) - self.response_times[req_id].get('response_1', 0)
                            print(f"   ⏱ Response 1 → Response 2: {diff:.2f} ms")
                        
                        print(f"   📈 Total responses received: {response_num}")
                        
                        # Dọn dẹp
                        del self.sent_time_map[req_id]
                        del self.response_count[req_id]
                        del self.response_times[req_id]

        except Exception as e:
            print(f"❌ [{self.account_name}] handle_message error: {e}")
            print(f"❌ Raw message: {message}")
            import traceback
            traceback.print_exc()

async def main():
    """Hàm chính - chạy test latency"""
    GATE_API_KEY = os.getenv('GATEIO_API_KEY')
    GATE_API_SECRET = os.getenv('GATEIO_API_SECRET')
    
    if not GATE_API_KEY or not GATE_API_SECRET:
        print("❌ Missing Gate.io API credentials in .env file")
        return
    
    gateIOAccount = GateIOAccount(GATE_API_KEY, GATE_API_SECRET, "GateIOAccount")
    
    print(f"🌐 Starting Gate.io latency test for {SYMBOL}...")
    print(f"   1. Wait 10 seconds")
    print(f"   2. Place BUY order for {SO_COIN_DANH} {SYMBOL}")
    print(f"   3. Show timing: Đặt lệnh → Response 1 and Response 2")
    
    tasks = [
        asyncio.create_task(gateIOAccount.start_ws()),
        asyncio.create_task(start_gateio_orderbook_ws(gateIOAccount))
    ]
    
    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("🛑 Shutting down...")
        for task in tasks:
            task.cancel()

if __name__ == "__main__":
    asyncio.run(main())
