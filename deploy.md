# 🚀 Hướng Dẫn Deploy Rust Trading Bot

## 📦 **Bước 1: Push Code lên Git**

### **1.1 Initialize Git (nếu chưa có)**
```bash
git init
git add .
git commit -m "Initial commit: Rust Gate.io trading bot"
```

### **1.2 Tạo Repository trên GitHub/GitLab**
1. Vào GitHub/GitLab tạo repository mới: `gateio-rust-trading`
2. Copy URL repository

### **1.3 Push lên remote**
```bash
# Add remote origin
git remote add origin https://github.com/username/gateio-rust-trading.git

# Push code
git branch -M main
git push -u origin main
```

## 🖥️ **Bước 2: Setup Server**

### **2.1 Kết nối Server**
```bash
# SSH vào server
ssh user@your-server-ip

# Hoặc nếu dùng key
ssh -i ~/.ssh/key.pem user@your-server-ip
```

### **2.2 Install Rust trên Server**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Verify installation
rustc --version
cargo --version
```

### **2.3 Install Dependencies**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev git

# CentOS/RHEL
sudo yum groupinstall -y "Development Tools"
sudo yum install -y openssl-devel git

# Alpine Linux
sudo apk add --no-cache build-base openssl-dev git
```

## 📥 **Bước 3: Clone và Deploy**

### **3.1 Clone Repository**
```bash
# Clone code về server
git clone https://github.com/username/gateio-rust-trading.git
cd gateio-rust-trading
```

### **3.2 Cấu hình Environment**
```bash
# Copy environment template
cp .env.example .env

# Edit với API credentials thật
nano .env
# Hoặc
vim .env
```

**Nội dung file `.env`:**
```env
GATEIO_API_KEY=your_real_api_key_here
GATEIO_API_SECRET=your_real_api_secret_here
RUST_LOG=info
```

### **3.3 Whitelist Server IP**
```bash
# Kiểm tra IP của server
curl -s https://ipinfo.io/ip
```

**Thêm IP này vào Gate.io whitelist!**

## 🚀 **Bước 4: Build và Run**

### **4.1 Build Release Version**
```bash
# Build optimized version
cargo build --release

# Kiểm tra binary
ls -la target/release/
```

### **4.2 Run Bot**
```bash
# Run directly
cargo run --release

# Hoặc run binary
./target/release/gateio-latency-test

# Run với logging
RUST_LOG=debug cargo run --release
```

## 📊 **Bước 5: Production Setup**

### **5.1 Tạo Systemd Service**
```bash
# Tạo service file
sudo nano /etc/systemd/system/gateio-bot.service
```

**Nội dung service:**
```ini
[Unit]
Description=Gate.io Rust Trading Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/gateio-rust-trading
Environment=RUST_LOG=info
ExecStart=/home/your-username/gateio-rust-trading/target/release/gateio-latency-test
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### **5.2 Enable và Start Service**
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable gateio-bot

# Start service
sudo systemctl start gateio-bot

# Check status
sudo systemctl status gateio-bot

# View logs
sudo journalctl -u gateio-bot -f
```

## 🔄 **Bước 6: Update Workflow**

### **6.1 Update Code trên Local**
```bash
# Sửa code...
git add .
git commit -m "Update: improved latency measurement"
git push origin main
```

### **6.2 Deploy Update lên Server**
```bash
# SSH vào server
ssh user@your-server-ip

# Navigate to project
cd gateio-rust-trading

# Pull latest changes
git pull origin main

# Rebuild
cargo build --release

# Restart service
sudo systemctl restart gateio-bot

# Check status
sudo systemctl status gateio-bot
```

## 📱 **Bước 7: Monitoring**

### **7.1 Real-time Logs**
```bash
# Follow logs
sudo journalctl -u gateio-bot -f

# Last 100 lines
sudo journalctl -u gateio-bot -n 100

# Logs from specific time
sudo journalctl -u gateio-bot --since "1 hour ago"
```

### **7.2 Performance Monitoring**
```bash
# Check CPU/Memory usage
top -p $(pgrep gateio-latency-test)

# Check network connections
netstat -tuln | grep :443

# Check disk usage
df -h
```

## 🔒 **Bước 8: Security Best Practices**

### **8.1 File Permissions**
```bash
# Secure .env file
chmod 600 .env
chown your-username:your-username .env

# Secure binary
chmod 755 target/release/gateio-latency-test
```

### **8.2 Firewall Setup**
```bash
# Allow SSH và HTTPS outbound
sudo ufw allow 22/tcp
sudo ufw allow out 443/tcp
sudo ufw enable
```

## 🎯 **Expected Output trên Server**

```bash
🌐 Starting Gate.io latency test for ALCH...
📋 Test plan:
   1. Connect to Gate.io orderbook WebSocket
   2. Authenticate trading WebSocket
   3. Wait for orderbook data
   4. Wait 10 seconds
   5. Place BUY order for 50 ALCH
   6. Measure latency for each response
   7. Show timing: Đặt lệnh → Response 1 and Response 2

✅ [GateIOAccount] Auth successful: Status 200, UID 16246256
📊 Orderbook updated - Ask price: 0.13452
⏰ Waiting 10 seconds before placing order...

🚀 [GateIOAccount] Placing order: BUY 50 alch_usdt @ 0.13452
⏱ Starting latency measurement...

📥 Response 1 received:
   ⏱ Latency từ lúc đặt lệnh → Response 1: 1.25 ms

📥 Response 2 received:
   ⏱ Latency từ lúc đặt lệnh → Response 2: 8.43 ms

🏁 Order processing completed!
📊 LATENCY SUMMARY:
   ⏱ Đặt lệnh → Response 1: 1.25 ms
   ⏱ Đặt lệnh → Response 2: 8.43 ms
   ⏱ Response 1 → Response 2: 7.18 ms
```

## 💡 **Performance Tips**

### **Server có thể có latency thấp hơn:**
- **Closer to exchange servers** (Singapore/US)
- **Better network infrastructure**
- **No local firewall interference**
- **Dedicated resources**

**Rust bot sẽ chạy 24/7 với ultra-low latency trên server! 🦀⚡** 