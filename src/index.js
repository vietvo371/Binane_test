require('dotenv').config();
const Binance = require('node-binance-api');

// Initialize Binance API with credentials
const binance = new Binance().options({
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_API_SECRET,
    useServerTime: true,
    verbose: false,
    recvWindow: 60000
});

// Cấu hình
const CONFIG = {
    UPDATE_INTERVAL: 1000, // Cập nhật mỗi 1 giây
    PRICE_CHANGE_THRESHOLD: 0.1, // Chỉ hiển thị khi giá thay đổi > 0.1%
    VOLUME_THRESHOLD: 1.0 // Chỉ hiển thị khi volume > 1.0
};

// Biến lưu trữ trạng thái
let lastUpdate = {
    time: 0,
    bidPrice: 0,
    askPrice: 0,
    bidVolume: 0,
    askVolume: 0,
    spread: 0
};

// Biến theo dõi thời gian
let timingMetrics = {
    lastPushTime: 0,
    lastGetTime: 0,
    pushLatency: [],
    getLatency: [],
    totalPushCount: 0,
    totalGetCount: 0,
    startTime: Date.now()
};

// Function to format time
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });
}

// Function to log timing statistics
function logTimingStats() {
    const now = Date.now();
    const uptime = (now - timingMetrics.startTime) / 1000;
    
    console.log('\n=== Timing Statistics ===');
    console.log(`Uptime: ${uptime.toFixed(2)} seconds`);
    console.log(`Total Push Count: ${timingMetrics.totalPushCount}`);
    console.log(`Total Get Count: ${timingMetrics.totalGetCount}`);
    
    if (timingMetrics.pushLatency.length > 0) {
        const avgPushLatency = timingMetrics.pushLatency.reduce((a, b) => a + b, 0) / timingMetrics.pushLatency.length;
        const maxPushLatency = Math.max(...timingMetrics.pushLatency);
        const minPushLatency = Math.min(...timingMetrics.pushLatency);
        console.log('\nPush Statistics:');
        console.log(`Average Push Latency: ${avgPushLatency.toFixed(2)}ms`);
        console.log(`Max Push Latency: ${maxPushLatency.toFixed(2)}ms`);
        console.log(`Min Push Latency: ${minPushLatency.toFixed(2)}ms`);
    }
    
    if (timingMetrics.getLatency.length > 0) {
        const avgGetLatency = timingMetrics.getLatency.reduce((a, b) => a + b, 0) / timingMetrics.getLatency.length;
        const maxGetLatency = Math.max(...timingMetrics.getLatency);
        const minGetLatency = Math.min(...timingMetrics.getLatency);
        console.log('\nGet Statistics:');
        console.log(`Average Get Latency: ${avgGetLatency.toFixed(2)}ms`);
        console.log(`Max Get Latency: ${maxGetLatency.toFixed(2)}ms`);
        console.log(`Min Get Latency: ${minGetLatency.toFixed(2)}ms`);
    }
    console.log('========================\n');
}

// Function to handle depth updates with throttling
function handleDepthUpdate(depth) {
    try {
        const { e: eventType, E: eventTime, s: symbol, u: updateId, b: bids, a: asks } = depth;
        
        // Cập nhật thời gian get
        const currentTime = Date.now();
        timingMetrics.lastGetTime = currentTime;
        timingMetrics.getLatency.push(currentTime - eventTime);
        timingMetrics.totalGetCount++;
        
        // Giới hạn số lượng metrics lưu trữ
        if (timingMetrics.getLatency.length > 100) {
            timingMetrics.getLatency.shift();
        }
        
        // Kiểm tra dữ liệu đầu vào
        if (!bids?.[0] || !asks?.[0]) {
            console.warn('Invalid orderbook data received');
            return;
        }

        const bidPrice = parseFloat(bids[0][0]);
        const bidVolume = parseFloat(bids[0][1]);
        const askPrice = parseFloat(asks[0][0]);
        const askVolume = parseFloat(asks[0][1]);

        // Kiểm tra giá trị hợp lệ
        if (isNaN(bidPrice) || isNaN(askPrice) || isNaN(bidVolume) || isNaN(askVolume)) {
            console.warn('Invalid price or volume data received');
            return;
        }

        // Tính toán phần trăm thay đổi (tránh chia cho 0)
        const bidPriceChange = lastUpdate.bidPrice === 0 ? 100 : 
            Math.abs((bidPrice - lastUpdate.bidPrice) / lastUpdate.bidPrice * 100);
        const askPriceChange = lastUpdate.askPrice === 0 ? 100 :
            Math.abs((askPrice - lastUpdate.askPrice) / lastUpdate.askPrice * 100);

        // Chỉ hiển thị khi có thay đổi đáng kể
        if (bidPriceChange > CONFIG.PRICE_CHANGE_THRESHOLD || 
            askPriceChange > CONFIG.PRICE_CHANGE_THRESHOLD ||
            bidVolume > CONFIG.VOLUME_THRESHOLD ||
            askVolume > CONFIG.VOLUME_THRESHOLD) {
            
            console.log(`\n=== Orderbook Update for ${symbol} ===`);
            console.log(`Event Time: ${formatTime(eventTime)}`);
            console.log(`Receive Time: ${formatTime(currentTime)}`);
            console.log(`Bid: ${bidPrice.toFixed(2)} (${bidVolume.toFixed(4)} units)`);
            console.log(`Ask: ${askPrice.toFixed(2)} (${askVolume.toFixed(4)} units)`);
            console.log(`Spread: ${((askPrice - bidPrice) / bidPrice * 100).toFixed(4)}%`);
            
            // Hiển thị thông tin thời gian
            const avgGetLatency = timingMetrics.getLatency.reduce((a, b) => a + b, 0) / timingMetrics.getLatency.length;
            console.log(`Get Latency: ${avgGetLatency.toFixed(2)}ms`);
            
            // Log timing stats every 100 updates
            if (timingMetrics.totalGetCount % 100 === 0) {
                logTimingStats();
            }
            
            // Cập nhật trạng thái
            lastUpdate = {
                ...lastUpdate,
                time: currentTime,
                bidPrice,
                askPrice,
                bidVolume,
                askVolume
            };
        }
    } catch (error) {
        console.error('Error in handleDepthUpdate:', error.message);
    }
}

// Function to handle book ticker updates
function handleBookTicker(ticker) {
    try {
        const { u: updateId, s: symbol, b: bidPrice, B: bidQty, a: askPrice, A: askQty } = ticker;
        
        // Cập nhật thời gian push
        const currentTime = Date.now();
        timingMetrics.lastPushTime = currentTime;
        timingMetrics.pushLatency.push(currentTime - Date.now());
        timingMetrics.totalPushCount++;
        
        // Giới hạn số lượng metrics lưu trữ
        if (timingMetrics.pushLatency.length > 100) {
            timingMetrics.pushLatency.shift();
        }
        
        // Kiểm tra dữ liệu đầu vào
        if (!bidPrice || !askPrice) {
            console.warn('Invalid ticker data received');
            return;
        }

        const bidPriceNum = parseFloat(bidPrice);
        const askPriceNum = parseFloat(askPrice);
        const bidQtyNum = parseFloat(bidQty);
        const askQtyNum = parseFloat(askQty);

        // Kiểm tra giá trị hợp lệ
        if (isNaN(bidPriceNum) || isNaN(askPriceNum) || isNaN(bidQtyNum) || isNaN(askQtyNum)) {
            console.warn('Invalid price or quantity data received');
            return;
        }

        const spread = (askPriceNum - bidPriceNum) / bidPriceNum * 100;
        
        // Chỉ hiển thị khi spread thay đổi đáng kể
        if (Math.abs(spread - lastUpdate.spread) > CONFIG.PRICE_CHANGE_THRESHOLD) {
            console.log(`\n=== BookTicker Update for ${symbol} ===`);
            console.log(`Push Time: ${formatTime(currentTime)}`);
            console.log(`Bid: ${bidPriceNum.toFixed(2)} (${bidQtyNum.toFixed(4)} units)`);
            console.log(`Ask: ${askPriceNum.toFixed(2)} (${askQtyNum.toFixed(4)} units)`);
            console.log(`Spread: ${spread.toFixed(4)}%`);
            
            // Hiển thị thông tin thời gian
            const avgPushLatency = timingMetrics.pushLatency.reduce((a, b) => a + b, 0) / timingMetrics.pushLatency.length;
            console.log(`Push Latency: ${avgPushLatency.toFixed(2)}ms`);
            
            // Log timing stats every 100 updates
            if (timingMetrics.totalPushCount % 100 === 0) {
                logTimingStats();
            }
            
            lastUpdate = {
                ...lastUpdate,
                time: currentTime,
                spread
            };
        }
    } catch (error) {
        console.error('Error in handleBookTicker:', error.message);
    }
}

// Connect to WebSocket for orderbook updates
console.log('Connecting to Binance WebSocket for orderbook updates...');
binance.websockets.depth(['BTCUSDT'], (data) => {
    console.log('Orderbook WebSocket connected successfully');
    handleDepthUpdate(data);
});

// Connect to WebSocket for book ticker updates
console.log('Connecting to Binance WebSocket for book ticker updates...');
binance.websockets.bookTickers((data) => {
    console.log('BookTicker WebSocket connected successfully');
    handleBookTicker(data);
});

// Add WebSocket error handling
binance.websockets.subscribe(['BTCUSDT'], (data) => {
    if (data.e === 'error') {
        console.error('WebSocket Error:', data);
    }
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

// Add periodic connection status check
setInterval(() => {
    const now = Date.now();
    console.log('\n=== Connection Status ===');
    console.log(`Last Get Update: ${formatTime(timingMetrics.lastGetTime)}`);
    console.log(`Last Push Update: ${formatTime(timingMetrics.lastPushTime)}`);
    console.log(`Time since last Get: ${((now - timingMetrics.lastGetTime)/1000).toFixed(2)}s`);
    console.log(`Time since last Push: ${((now - timingMetrics.lastPushTime)/1000).toFixed(2)}s`);
    console.log('========================\n');
}, 30000); // Check every 30 seconds

// Hàm đo thời gian thực hiện
async function measureExecutionTime(fn, ...args) {
    const startTime = Date.now();
    try {
        const result = await fn(...args);
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        console.log(`Execution time for ${fn.name}: ${executionTime}ms`);
        return { result, executionTime };
    } catch (error) {
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        console.error(`Error in ${fn.name} after ${executionTime}ms:`, error);
        throw error;
    }
}

// Ví dụ về các lệnh GET với đo thời gian
async function getAccountInfo() {
    try {
        const startTime = Date.now();
        const accountInfo = await binance.account();
        const endTime = Date.now();
        console.log(`GET Account Info - Time: ${endTime - startTime}ms`);
        return accountInfo;
    } catch (error) {
        console.error('Error getting account info:', error);
    }
}

async function getOrderBook(symbol = 'BTCUSDT', limit = 5) {
    try {
        const startTime = Date.now();
        const orderBook = await binance.depth(symbol, { limit });
        const endTime = Date.now();
        console.log(`GET Order Book - Time: ${endTime - startTime}ms`);
        return orderBook;
    } catch (error) {
        console.error('Error getting order book:', error);
    }
}

async function get24hrTicker(symbol = 'BTCUSDT') {
    try {
        const startTime = Date.now();
        const ticker = await binance.prevDay(symbol);
        const endTime = Date.now();
        console.log(`GET 24hr Ticker - Time: ${endTime - startTime}ms`);
        return ticker;
    } catch (error) {
        console.error('Error getting 24hr ticker:', error);
    }
}

// Ví dụ về các lệnh POST với đo thời gian
async function createOrder(symbol = 'BTCUSDT', side = 'BUY', quantity = 0.001) {
    try {
        const startTime = Date.now();
        const order = await binance.marketBuy(symbol, quantity);
        const endTime = Date.now();
        console.log(`POST Market Order - Time: ${endTime - startTime}ms`);
        return order;
    } catch (error) {
        console.error('Error creating order:', error);
    }
}

async function createLimitOrder(symbol = 'BTCUSDT', side = 'BUY', quantity = 0.001, price = 50000) {
    try {
        const startTime = Date.now();
        const order = await binance.buy(symbol, quantity, price);
        const endTime = Date.now();
        console.log(`POST Limit Order - Time: ${endTime - startTime}ms`);
        return order;
    } catch (error) {
        console.error('Error creating limit order:', error);
    }
}

async function cancelOrder(symbol = 'BTCUSDT', orderId) {
    try {
        const startTime = Date.now();
        const result = await binance.cancel(symbol, orderId);
        const endTime = Date.now();
        console.log(`POST Cancel Order - Time: ${endTime - startTime}ms`);
        return result;
    } catch (error) {
        console.error('Error canceling order:', error);
    }
}

// Hàm test các lệnh với thống kê thời gian
async function testApiCommandsWithTiming() {
    console.log('\n=== Testing GET Commands with Timing ===');
    const getResults = {
        accountInfo: await measureExecutionTime(getAccountInfo),
        orderBook: await measureExecutionTime(getOrderBook),
        ticker24h: await measureExecutionTime(get24hrTicker)
    };

    console.log('\n=== GET Commands Timing Summary ===');
    Object.entries(getResults).forEach(([name, { executionTime }]) => {
        console.log(`${name}: ${executionTime}ms`);
    });

    console.log('\n=== Testing POST Commands with Timing ===');
    // Lưu ý: Các lệnh POST này sẽ thực sự tạo lệnh giao dịch
    // Hãy cẩn thận khi sử dụng trong môi trường thực tế
    /*
    const postResults = {
        marketOrder: await measureExecutionTime(createOrder),
        limitOrder: await measureExecutionTime(createLimitOrder),
        cancelOrder: await measureExecutionTime(cancelOrder)
    };

    console.log('\n=== POST Commands Timing Summary ===');
    Object.entries(postResults).forEach(([name, { executionTime }]) => {
        console.log(`${name}: ${executionTime}ms`);
    });
    */
}

// Gọi hàm test
// testApiCommandsWithTiming(); 