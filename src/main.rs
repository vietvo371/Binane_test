use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha512;
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

type HmacSha512 = Hmac<Sha512>;

const SYMBOL: &str = "ALCH";
const SO_COIN_DANH: f64 = 50.0;

#[derive(Debug, Clone)]
struct SharePrice {
    gia_mua_gate: Option<f64>,
    time_gia_gate: Option<String>,
    orderbook_ready: bool,
}

impl Default for SharePrice {
    fn default() -> Self {
        Self {
            gia_mua_gate: None,
            time_gia_gate: None,
            orderbook_ready: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct OrderbookSubscribe {
    time: u64,
    channel: String,
    event: String,
    payload: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthRequest {
    time: u64,
    channel: String,
    event: String,
    payload: AuthPayload,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthPayload {
    api_key: String,
    signature: String,
    timestamp: String,
    req_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OrderRequest {
    time: u64,
    channel: String,
    event: String,
    payload: OrderPayload,
}

#[derive(Debug, Serialize, Deserialize)]
struct OrderPayload {
    req_id: String,
    req_param: OrderParam,
}

#[derive(Debug, Serialize, Deserialize)]
struct OrderParam {
    currency_pair: String,
    side: String,
    #[serde(rename = "type")]
    order_type: String,
    amount: String,
    price: String,
    time_in_force: String,
}

#[derive(Debug, Clone)]
struct GateIOAccount {
    api_key: String,
    api_secret: String,
    account_name: String,
    authenticated: Arc<Mutex<bool>>,
    sent_time_map: Arc<Mutex<HashMap<String, Instant>>>,
    response_count: Arc<Mutex<HashMap<String, u32>>>,
    response_times: Arc<Mutex<HashMap<String, HashMap<String, f64>>>>,
}

impl GateIOAccount {
    fn new(api_key: String, api_secret: String, account_name: String) -> Self {
        Self {
            api_key,
            api_secret,
            account_name,
            authenticated: Arc::new(Mutex::new(false)),
            sent_time_map: Arc::new(Mutex::new(HashMap::new())),
            response_count: Arc::new(Mutex::new(HashMap::new())),
            response_times: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn get_ts(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    fn get_ts_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    fn create_signature(&self, channel: &str, request_param: &str, ts: u64) -> String {
        let sign_string = format!("api\n{}\n{}\n{}", channel, request_param, ts);
        
        println!("   🔧 Sign string: {:?}", sign_string);
        
        let mut mac = HmacSha512::new_from_slice(self.api_secret.as_bytes())
            .expect("HMAC can take key of any size");
        mac.update(sign_string.as_bytes());
        
        hex::encode(mac.finalize().into_bytes())
    }

    async fn authenticate(&self, ws_sender: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
        let timestamp = self.get_ts();
        let req_id = format!("auth-{}", self.get_ts_ms());
        let request_param = "";
        
        println!("🔐 [{}] Starting authentication...", self.account_name);
        println!("   📋 API Key: {}...{}", &self.api_key[..10], &self.api_key[self.api_key.len()-10..]);
        println!("   🕒 Timestamp: {}", timestamp);
        println!("   🆔 Request ID: {}", req_id);
        
        let signature = self.create_signature("spot.login", request_param, timestamp);
        println!("   ✍️ Signature: {}...", &signature[..20]);
        
        let auth_request = AuthRequest {
            time: timestamp,
            channel: "spot.login".to_string(),
            event: "api".to_string(),
            payload: AuthPayload {
                api_key: self.api_key.clone(),
                signature,
                timestamp: timestamp.to_string(),
                req_id,
            },
        };
        
        let auth_json = serde_json::to_string(&auth_request)?;
        println!("   📦 Auth payload: {}...", &auth_json[..150]);
        
        ws_sender.send(Message::Text(auth_json)).await?;
        println!("   📤 Authentication request sent");
        
        Ok(())
    }

    async fn create_order(
        &self,
        ws_sender: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>,
        side: &str,
        symbol: &str,
        quantity: f64,
        price: f64,
        order_type: &str,
        time_in_force: &str,
    ) -> Result<()> {
        let authenticated = *self.authenticated.lock().unwrap();
        if !authenticated || quantity <= 0.0 || price <= 0.0 {
            println!("❌ [{}] Cannot place order - not authenticated or invalid params", self.account_name);
            return Ok(());
        }

        let ts = self.get_ts();
        let req_id = self.get_ts_ms().to_string();

        let order_param = OrderParam {
            currency_pair: symbol.to_string(),
            side: side.to_lowercase(),
            order_type: order_type.to_lowercase(),
            amount: quantity.to_string(),
            price: price.to_string(),
            time_in_force: time_in_force.to_lowercase(),
        };

        let order_request = OrderRequest {
            time: ts,
            channel: "spot.order_place".to_string(),
            event: "api".to_string(),
            payload: OrderPayload {
                req_id: req_id.clone(),
                req_param: order_param,
            },
        };

        // Lưu thời gian gửi lệnh
        let send_time = Instant::now();
        self.sent_time_map.lock().unwrap().insert(req_id.clone(), send_time);
        self.response_count.lock().unwrap().insert(req_id.clone(), 0);
        self.response_times.lock().unwrap().insert(req_id.clone(), HashMap::new());

        let now: DateTime<Utc> = Utc::now();
        println!("\n🚀 [{}] Placing order: {} {} {} @ {}", 
            self.account_name, side, quantity, symbol, price);
        println!("🕒 Order sent at: {}", now.format("%H:%M:%S%.6f"));
        println!("⏱ Starting latency measurement...");

        // Gửi lệnh
        let order_json = serde_json::to_string(&order_request)?;
        ws_sender.send(Message::Text(order_json)).await?;

        Ok(())
    }

    fn handle_message(&self, message: &str) -> Result<()> {
        let response: Value = serde_json::from_str(message)?;
        let received_time = Instant::now();

        // Parse channel và event từ header hoặc root level
        let header = response.get("header").and_then(|h| h.as_object());
        let channel = header
            .and_then(|h| h.get("channel"))
            .or_else(|| response.get("channel"))
            .and_then(|c| c.as_str())
            .unwrap_or("");
        let event = header
            .and_then(|h| h.get("event"))
            .or_else(|| response.get("event"))
            .and_then(|e| e.as_str())
            .unwrap_or("");

        // Debug: In message
        if channel == "spot.login" && event == "api" {
            println!("📨 [{}] Full auth message: {}", self.account_name, message);
        } else {
            let short_msg = if message.len() > 100 { &message[..100] } else { message };
            println!("📨 [{}] Received {}/{}: {}...", self.account_name, channel, event, short_msg);
        }

        // Xử lý authentication
        if channel == "spot.login" && event == "api" {
            println!("🔐 [{}] Processing authentication response...", self.account_name);
            
            let status = header
                .and_then(|h| h.get("status"))
                .or_else(|| response.get("status"))
                .and_then(|s| s.as_str())
                .unwrap_or("");

            println!("   📊 Header: {:?}", header);
            println!("   📊 Status found: {}", status);

            if status == "200" {
                // Check for UID in data.result
                let uid = response
                    .get("data")
                    .and_then(|d| d.get("result"))
                    .and_then(|r| r.get("uid"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("unknown");

                println!("✅ [{}] Auth successful: Status {}, UID {}", self.account_name, status, uid);
                *self.authenticated.lock().unwrap() = true;
                println!("🎯 [{}] AUTHENTICATED flag set to true", self.account_name);
            } else {
                let error_msg = format!("Status: {}", status);
                let error = header
                    .and_then(|h| h.get("message"))
                    .or_else(|| response.get("error"))
                    .and_then(|e| e.as_str())
                    .unwrap_or(&error_msg);
                println!("❌ [{}] Auth failed: {}", self.account_name, error);
            }
            return Ok(());
        }

        // Xử lý ping/pong response
        if channel == "spot.ping" || channel == "spot.pong" {
            println!("📡 [{}] Ping/Pong response received", self.account_name);
            return Ok(());
        }

        // Xử lý phản hồi đặt lệnh
        if channel == "spot.order_place" && event == "api" {
            println!("📋 [{}] Processing order response...", self.account_name);

            let req_id = header
                .and_then(|h| h.get("request_id"))
                .or_else(|| response.get("request_id"))
                .and_then(|r| r.as_str())
                .unwrap_or("");

            if !req_id.is_empty() {
                let mut sent_time_map = self.sent_time_map.lock().unwrap();
                if let Some(&sent_time) = sent_time_map.get(req_id) {
                    let latency = received_time.duration_since(sent_time);
                    let latency_ms = latency.as_secs_f64() * 1000.0;

                    // Đếm số lần phản hồi
                    let mut response_count = self.response_count.lock().unwrap();
                    let count = response_count.entry(req_id.to_string()).or_insert(0);
                    *count += 1;
                    let response_num = *count;

                    // Lưu thời gian phản hồi
                    let mut response_times = self.response_times.lock().unwrap();
                    let times = response_times.entry(req_id.to_string()).or_insert_with(HashMap::new);
                    times.insert(format!("response_{}", response_num), latency_ms);

                    let status = header
                        .and_then(|h| h.get("status"))
                        .or_else(|| response.get("status"))
                        .and_then(|s| s.as_str())
                        .unwrap_or("unknown");

                    let now: DateTime<Utc> = Utc::now();
                    println!("\n📥 Response {} received:", response_num);
                    println!("   🕒 Time: {}", now.format("%H:%M:%S%.6f"));
                    println!("   ⏱ Latency từ lúc đặt lệnh → Response {}: {:.2} ms", response_num, latency_ms);
                    println!("   📊 Status: {}", status);

                    // In thông tin chi tiết phản hồi
                    let result = response.get("result");
                    if status == "201" {
                        println!("   ✅ Order success: {:?}", result);
                    } else if status == "400" {
                        let err_msg = header
                            .and_then(|h| h.get("message"))
                            .or_else(|| result.and_then(|r| r.get("message")))
                            .and_then(|m| m.as_str())
                            .unwrap_or("Unknown error");
                        println!("   ❌ Order rejected: {}", err_msg);
                    } else {
                        println!("   📋 Response result: {:?}", result);
                    }

                    // Nếu là phản hồi cuối cùng hoặc có lỗi, in tổng kết
                    if response_num >= 2 || status == "201" || status == "400" {
                        println!("\n🏁 [{}] Order processing completed!", self.account_name);
                        println!("📊 LATENCY SUMMARY:");

                        let times = response_times.get(req_id).unwrap();
                        if let Some(&response_1) = times.get("response_1") {
                            println!("   ⏱ Đặt lệnh → Response 1: {:.2} ms", response_1);
                        }

                        if let Some(&response_2) = times.get("response_2") {
                            println!("   ⏱ Đặt lệnh → Response 2: {:.2} ms", response_2);
                        }

                        if response_num >= 2 {
                            if let (Some(&r1), Some(&r2)) = (times.get("response_1"), times.get("response_2")) {
                                let diff = r2 - r1;
                                println!("   ⏱ Response 1 → Response 2: {:.2} ms", diff);
                            }
                        }

                        println!("   📈 Total responses received: {}", response_num);

                        // Dọn dẹp
                        sent_time_map.remove(req_id);
                        response_count.remove(req_id);
                        response_times.remove(req_id);
                    }
                }
            }
        }

        Ok(())
    }
}

async fn start_gateio_orderbook_ws(account: Arc<GateIOAccount>) -> Result<()> {
    let pair = format!("{}_USDT", SYMBOL);
    let ws_url = "wss://api.gateio.ws/ws/v4/";
    
    let (ws_stream, _) = connect_async(Url::parse(ws_url)?).await?;
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    println!("📡 Connecting to Gate.io orderbook for {}...", pair);
    
    let subscribe_msg = OrderbookSubscribe {
        time: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        channel: "spot.book_ticker".to_string(),
        event: "subscribe".to_string(),
        payload: vec![pair.clone()],
    };
    
    let subscribe_json = serde_json::to_string(&subscribe_msg)?;
    ws_sender.send(Message::Text(subscribe_json)).await?;
    println!("✅ Subscribed to Gate.io orderbook for {}", pair);

    let share_price = Arc::new(Mutex::new(SharePrice::default()));
    let order_placed = Arc::new(Mutex::new(false));
    let last_price_print = Arc::new(Mutex::new(Instant::now()));

    while let Some(message) = ws_receiver.next().await {
        match message? {
            Message::Text(text) => {
                if let Ok(data) = serde_json::from_str::<Value>(&text) {
                    if data.get("channel").and_then(|c| c.as_str()) == Some("spot.book_ticker")
                        && data.get("event").and_then(|e| e.as_str()) == Some("update")
                    {
                        if let Some(result) = data.get("result") {
                            if result.get("s").and_then(|s| s.as_str()) == Some(&pair) {
                                let best_ask = result.get("a")
                                    .and_then(|a| a.as_str())
                                    .and_then(|a| a.parse::<f64>().ok())
                                    .unwrap_or(0.0);

                                let mut sp = share_price.lock().unwrap();
                                let old_price = sp.gia_mua_gate;
                                sp.gia_mua_gate = Some(best_ask);
                                sp.time_gia_gate = Some(Utc::now().format("%Y-%m-%d %H:%M:%S%.6f").to_string());
                                sp.orderbook_ready = true;

                                // Chỉ in khi có thay đổi đáng kể hoặc mỗi 5 giây
                                let mut last_print = last_price_print.lock().unwrap();
                                let current_time = Instant::now();
                                let should_print = old_price.is_none()
                                    || old_price.map_or(true, |old| (best_ask - old).abs() > 0.001)
                                    || current_time.duration_since(*last_print).as_secs() > 5;

                                if should_print {
                                    println!("📊 Orderbook updated - Ask price: {}", best_ask);
                                    *last_print = current_time;
                                }

                                // Chỉ đặt lệnh 1 lần khi có giá, đã authentication và chưa đặt lệnh
                                let authenticated = *account.authenticated.lock().unwrap();
                                let mut placed = order_placed.lock().unwrap();
                                
                                if !*placed && best_ask > 0.0 && authenticated {
                                    *placed = true;
                                    println!("⏰ Waiting 10 seconds before placing order...");
                                    
                                    // Clone để sử dụng trong task khác
                                    let account_clone = account.clone();
                                    let best_ask_clone = best_ask;
                                    
                                    tokio::spawn(async move {
                                        sleep(Duration::from_secs(10)).await;
                                        
                                        // Tạo một WebSocket connection mới cho order
                                        if let Ok((order_ws_stream, _)) = connect_async(Url::parse(ws_url).unwrap()).await {
                                            let (mut order_sender, _) = order_ws_stream.split();
                                            
                                            let _ = account_clone.create_order(
                                                &mut order_sender,
                                                "BUY",
                                                &format!("{}_usdt", SYMBOL.to_lowercase()),
                                                SO_COIN_DANH,
                                                best_ask_clone,
                                                "limit",
                                                "gtc",
                                            ).await;
                                        }
                                    });
                                } else if !*placed && should_print {
                                    if best_ask <= 0.0 {
                                        println!("⚠️ Not placing order: Invalid price {}", best_ask);
                                    } else if !authenticated {
                                        println!("⚠️ Not placing order: Not authenticated yet");
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    Ok(())
}

async fn start_trading_ws(account: Arc<GateIOAccount>) -> Result<()> {
    let ws_url = "wss://api.gateio.ws/ws/v4/";
    
    loop {
        match connect_async(Url::parse(ws_url)?).await {
            Ok((ws_stream, _)) => {
                println!("🔌 Connecting to Gate.io WS for trading...");
                let (mut ws_sender, mut ws_receiver) = ws_stream.split();
                
                println!("✅ [{}] Connected to Gate.io WS", account.account_name);
                
                // Authenticate
                if let Err(e) = account.authenticate(&mut ws_sender).await {
                    error!("Authentication failed: {}", e);
                    continue;
                }
                
                // Send ping periodically
                let account_clone = account.clone();
                tokio::spawn(async move {
                    loop {
                        sleep(Duration::from_secs(30)).await;
                        println!("📡 [{}] Ping sent", account_clone.account_name);
                        // Note: In real implementation, we'd need to send ping through the sender
                    }
                });
                
                // Handle messages
                while let Some(message) = ws_receiver.next().await {
                    match message {
                        Ok(Message::Text(text)) => {
                            if let Err(e) = account.handle_message(&text) {
                                error!("Error handling message: {}", e);
                            }
                        }
                        Ok(Message::Close(_)) => {
                            warn!("WebSocket connection closed");
                            break;
                        }
                        Err(e) => {
                            error!("WebSocket error: {}", e);
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Err(e) => {
                error!("Failed to connect: {}", e);
                sleep(Duration::from_secs(3)).await;
            }
        }
        
        info!("🔄 Reconnecting in 3 seconds...");
        sleep(Duration::from_secs(3)).await;
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    dotenv::dotenv().ok();

    let gate_api_key = env::var("GATEIO_API_KEY")
        .map_err(|_| anyhow::anyhow!("GATEIO_API_KEY not found in environment"))?;
    let gate_api_secret = env::var("GATEIO_API_SECRET")
        .map_err(|_| anyhow::anyhow!("GATEIO_API_SECRET not found in environment"))?;

    let account = Arc::new(GateIOAccount::new(
        gate_api_key,
        gate_api_secret,
        "GateIOAccount".to_string(),
    ));

    println!("🌐 Starting Gate.io latency test for {}...", SYMBOL);
    println!("📋 Test plan:");
    println!("   1. Connect to Gate.io orderbook WebSocket");
    println!("   2. Authenticate trading WebSocket");
    println!("   3. Wait for orderbook data");
    println!("   4. Wait 10 seconds");
    println!("   5. Place BUY order for {} {}", SO_COIN_DANH, SYMBOL);
    println!("   6. Measure latency for each response");
    println!("   7. Show timing: Đặt lệnh → Response 1 and Response 2");

    // Start both tasks concurrently
    let trading_task = start_trading_ws(account.clone());
    let orderbook_task = start_gateio_orderbook_ws(account.clone());

    tokio::select! {
        result = trading_task => {
            if let Err(e) = result {
                error!("Trading WebSocket error: {}", e);
            }
        }
        result = orderbook_task => {
            if let Err(e) = result {
                error!("Orderbook WebSocket error: {}", e);
            }
        }
    }

    Ok(())
} 