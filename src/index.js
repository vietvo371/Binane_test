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
    VOLUME_THRESHOLD: 1.0, // Chỉ hiển thị khi volume > 1.0
    SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'], // Thêm các symbol cần theo dõi
    ORDERBOOK_DEPTH: 10 // Độ sâu của orderbook
};

// Biến lưu trữ trạng thái cho từng symbol
let lastUpdates = {};
let orderbooks = {};

CONFIG.SYMBOLS.forEach(symbol => {
    lastUpdates[symbol] = {
        time: 0,
        bidPrice: 0,
        askPrice: 0,
        bidVolume: 0,
        askVolume: 0,
        spread: 0,
        lastGetTime: 0,
        getLatency: []
    };
    orderbooks[symbol] = {
        bids: [],
        asks: [],
        lastUpdateId: 0
    };
});

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

// Function to get orderbook data
async function getOrderbook(symbol, limit = CONFIG.ORDERBOOK_DEPTH) {
    try {
        const startTime = Date.now();
        const orderbook = await binance.depth(symbol, { limit });
        const endTime = Date.now();
        console.log(`\n=== Orderbook for ${symbol} ===`);
        console.log(`Request Time: ${formatTime(startTime)}`);
        console.log(`Response Time: ${formatTime(endTime)}`);
        console.log(`Latency: ${endTime - startTime}ms`);
        
        // Format and display bids
        console.log('\nBids:');
        orderbook.bids.slice(0, limit).forEach((bid, index) => {
            console.log(`${index + 1}. Price: ${parseFloat(bid[0]).toFixed(2)} | Quantity: ${parseFloat(bid[1]).toFixed(4)}`);
        });
        
        // Format and display asks
        console.log('\nAsks:');
        orderbook.asks.slice(0, limit).forEach((ask, index) => {
            console.log(`${index + 1}. Price: ${parseFloat(ask[0]).toFixed(2)} | Quantity: ${parseFloat(ask[1]).toFixed(4)}`);
        });
        
        // Calculate and display spread
        const bestBid = parseFloat(orderbook.bids[0][0]);
        const bestAsk = parseFloat(orderbook.asks[0][0]);
        const spread = ((bestAsk - bestBid) / bestBid * 100).toFixed(4);
        console.log(`\nSpread: ${spread}%`);
        
        return orderbook;
    } catch (error) {
        console.error(`Error getting orderbook for ${symbol}:`, error.message);
        return null;
    }
}

// Function to log timing statistics for a symbol
function logSymbolStats(symbol) {
    const stats = lastUpdates[symbol];
    const now = Date.now();
    
    console.log(`\n=== ${symbol} Statistics ===`);
    console.log(`Last Update Time: ${formatTime(stats.lastGetTime)}`);
    console.log(`Time since last update: ${((now - stats.lastGetTime)/1000).toFixed(2)}s`);
    
    if (stats.getLatency.length > 0) {
        const avgLatency = stats.getLatency.reduce((a, b) => a + b, 0) / stats.getLatency.length;
        const maxLatency = Math.max(...stats.getLatency);
        const minLatency = Math.min(...stats.getLatency);
        console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
        console.log(`Max Latency: ${maxLatency.toFixed(2)}ms`);
        console.log(`Min Latency: ${minLatency.toFixed(2)}ms`);
    }
    console.log('========================\n');
}

// Function to handle depth updates with throttling
function handleDepthUpdate(depth) {
    try {
        const { e: eventType, E: eventTime, s: symbol, u: updateId, b: bids, a: asks } = depth;
        
        // Cập nhật thời gian get
        const currentTime = Date.now();
        const latency = currentTime - eventTime;
        
        if (!lastUpdates[symbol]) {
            lastUpdates[symbol] = {
                time: 0,
                bidPrice: 0,
                askPrice: 0,
                bidVolume: 0,
                askVolume: 0,
                spread: 0,
                lastGetTime: 0,
                getLatency: []
            };
        }
        
        // Cập nhật orderbook
        if (!orderbooks[symbol]) {
            orderbooks[symbol] = {
                bids: [],
                asks: [],
                lastUpdateId: 0
            };
        }
        
        // Cập nhật orderbook với dữ liệu mới
        orderbooks[symbol].bids = bids.slice(0, CONFIG.ORDERBOOK_DEPTH);
        orderbooks[symbol].asks = asks.slice(0, CONFIG.ORDERBOOK_DEPTH);
        orderbooks[symbol].lastUpdateId = updateId;
        
        lastUpdates[symbol].lastGetTime = currentTime;
        lastUpdates[symbol].getLatency.push(latency);
        
        // Giới hạn số lượng metrics lưu trữ
        if (lastUpdates[symbol].getLatency.length > 100) {
            lastUpdates[symbol].getLatency.shift();
        }
        
        // Kiểm tra dữ liệu đầu vào
        if (!bids?.[0] || !asks?.[0]) {
            console.warn(`Invalid orderbook data received for ${symbol}`);
            return;
        }

        const bidPrice = parseFloat(bids[0][0]);
        const bidVolume = parseFloat(bids[0][1]);
        const askPrice = parseFloat(asks[0][0]);
        const askVolume = parseFloat(asks[0][1]);

        // Kiểm tra giá trị hợp lệ
        if (isNaN(bidPrice) || isNaN(askPrice) || isNaN(bidVolume) || isNaN(askVolume)) {
            console.warn(`Invalid price or volume data received for ${symbol}`);
            return;
        }

        // Tính toán phần trăm thay đổi
        const bidPriceChange = lastUpdates[symbol].bidPrice === 0 ? 100 : 
            Math.abs((bidPrice - lastUpdates[symbol].bidPrice) / lastUpdates[symbol].bidPrice * 100);
        const askPriceChange = lastUpdates[symbol].askPrice === 0 ? 100 :
            Math.abs((askPrice - lastUpdates[symbol].askPrice) / lastUpdates[symbol].askPrice * 100);

        // Chỉ hiển thị khi có thay đổi đáng kể
        if (bidPriceChange > CONFIG.PRICE_CHANGE_THRESHOLD || 
            askPriceChange > CONFIG.PRICE_CHANGE_THRESHOLD ||
            bidVolume > CONFIG.VOLUME_THRESHOLD ||
            askVolume > CONFIG.VOLUME_THRESHOLD) {
            
            console.log(`\n=== Orderbook Update for ${symbol} ===`);
            console.log(`Event Time: ${formatTime(eventTime)}`);
            console.log(`Receive Time: ${formatTime(currentTime)}`);
            console.log(`Latency: ${latency}ms`);
            console.log(`Bid: ${bidPrice.toFixed(2)} (${bidVolume.toFixed(4)} units)`);
            console.log(`Ask: ${askPrice.toFixed(2)} (${askVolume.toFixed(4)} units)`);
            console.log(`Spread: ${((askPrice - bidPrice) / bidPrice * 100).toFixed(4)}%`);
            
            // Hiển thị orderbook hiện tại
            console.log('\nCurrent Orderbook:');
            console.log('Bids:');
            orderbooks[symbol].bids.forEach((bid, index) => {
                console.log(`${index + 1}. Price: ${parseFloat(bid[0]).toFixed(2)} | Quantity: ${parseFloat(bid[1]).toFixed(4)}`);
            });
            console.log('\nAsks:');
            orderbooks[symbol].asks.forEach((ask, index) => {
                console.log(`${index + 1}. Price: ${parseFloat(ask[0]).toFixed(2)} | Quantity: ${parseFloat(ask[1]).toFixed(4)}`);
            });
            
            // Cập nhật trạng thái
            lastUpdates[symbol] = {
                ...lastUpdates[symbol],
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

// Connect to WebSocket for orderbook updates
console.log('Connecting to Binance WebSocket for orderbook updates...');
binance.websockets.depth(CONFIG.SYMBOLS, (data) => {
    handleDepthUpdate(data);
});

// Add WebSocket error handling
binance.websockets.subscribe(CONFIG.SYMBOLS, (data) => {
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

// Add periodic connection status check and orderbook update
setInterval(async () => {
    console.log('\n=== Connection Status ===');
    for (const symbol of CONFIG.SYMBOLS) {
        logSymbolStats(symbol);
        // Get fresh orderbook data every 30 seconds
        await getOrderbook(symbol);
    }
}, 30000); // Check every 30 seconds

// Export functions for external use
module.exports = {
    getOrderbook,
    CONFIG
};

// Gọi hàm test
// testApiCommandsWithTiming(); 