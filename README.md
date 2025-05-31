# Gate.io Latency Test - Rust Version

🦀 **High-performance Rust implementation** của Gate.io latency testing tool.

## ✨ Tính năng

- **Ultra-low latency**: Rust với zero-cost abstractions
- **WebSocket real-time**: Kết nối orderbook và trading
- **Nanosecond precision**: Đo latency chính xác tới nanosecond  
- **Async/await**: Hiệu suất cao với Tokio runtime
- **Memory safety**: Rust compile-time guarantees

## 📦 Cài đặt

### 1. Cài đặt Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### 2. Clone project
```bash
git clone <your-repo>
cd Test_Gateio
```

### 3. Cấu hình API keys
Tạo file `.env`:
```env
GATEIO_API_KEY=your_gate_io_api_key
GATEIO_API_SECRET=your_gate_io_api_secret
```

## 🚀 Chạy chương trình

```bash
# Build & run
cargo run

# Release mode (tối ưu performance)
cargo run --release

# Với logging
RUST_LOG=info cargo run --release
```

## 📊 Output mẫu

```
🌐 Starting Gate.io latency test for ALCH...
📋 Test plan:
   1. Connect to Gate.io orderbook WebSocket
   2. Authenticate trading WebSocket
   3. Wait for orderbook data
   4. Wait 10 seconds
   5. Place BUY order for 50 ALCH
   6. Measure latency for each response
   7. Show timing: Đặt lệnh → Response 1 and Response 2

🔌 Connecting to Gate.io WS for trading...
✅ [GateIOAccount] Connected to Gate.io WS
🔐 [GateIOAccount] Starting authentication...
✅ [GateIOAccount] Auth successful: Status 200, UID 16246256

📡 Connecting to Gate.io orderbook for ALCH_USDT...
✅ Subscribed to Gate.io orderbook for ALCH_USDT
📊 Orderbook updated - Ask price: 0.02789

⏰ Waiting 10 seconds before placing order...

🚀 [GateIOAccount] Placing order: BUY 50 alch_usdt @ 0.02789
🕒 Order sent at: 14:32:18.123456
⏱ Starting latency measurement...

📥 Response 1 received:
   🕒 Time: 14:32:18.125701
   ⏱ Latency từ lúc đặt lệnh → Response 1: 2.25 ms
   📊 Status: 201

📥 Response 2 received:
   🕒 Time: 14:32:18.133834
   ⏱ Latency từ lúc đặt lệnh → Response 2: 10.68 ms
   📊 Status: 201

🏁 [GateIOAccount] Order processing completed!
📊 LATENCY SUMMARY:
   ⏱ Đặt lệnh → Response 1: 2.25 ms
   ⏱ Đặt lệnh → Response 2: 10.68 ms
   ⏱ Response 1 → Response 2: 8.43 ms
   📈 Total responses received: 2
```

## 🔧 Cấu hình

Trong `src/main.rs`:

```rust
const SYMBOL: &str = "ALCH";        // Coin symbol
const SO_COIN_DANH: f64 = 50.0;     // Quantity to buy
```

## 🏗️ Kiến trúc

- **Tokio**: Async runtime cho high-performance
- **tokio-tungstenite**: WebSocket client
- **serde**: JSON serialization/deserialization  
- **HMAC-SHA512**: Signature authentication
- **Arc<Mutex<T>>**: Thread-safe shared state

## 🚀 Performance vs Python

| Metric | Python | Rust |
|--------|--------|------|
| Memory usage | ~50MB | ~5MB |
| Startup time | ~500ms | ~50ms |
| Latency precision | Millisecond | Nanosecond |
| CPU usage | High | Low |

## 📝 Logic flow

1. **Khởi tạo**: Load API credentials, tạo account instance
2. **WebSocket connections**: 
   - Trading WS cho authentication & orders
   - Orderbook WS cho real-time prices
3. **Authentication**: HMAC-SHA512 signature
4. **Wait for data**: Chờ orderbook có giá ask 
5. **10-second delay**: Theo yêu cầu
6. **Place order**: BUY limit order với ask price
7. **Measure latency**: Track 2 responses với nanosecond precision

## 🛠️ Development

```bash
# Format code
cargo fmt

# Lint
cargo clippy

# Test
cargo test

# Check
cargo check
```

## 📚 Dependencies

- `tokio`: Async runtime
- `tokio-tungstenite`: WebSocket 
- `serde`: JSON handling
- `chrono`: Time/date utilities
- `hmac`, `sha2`: Cryptographic signing
- `anyhow`: Error handling
- `log`, `env_logger`: Logging

## 🔒 Bảo mật

- API keys stored in `.env` file
- HMAC-SHA512 authentication
- Memory-safe Rust prevents buffer overflows
- No credential logging

---

**Rust version được tối ưu cho ultra-low latency và high-performance trading applications! 🦀⚡** 