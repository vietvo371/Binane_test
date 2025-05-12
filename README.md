# Binance WebSocket Trading Bot

This project implements a real-time trading bot using Binance WebSocket API to monitor orderbook and book ticker data.

## Features

- Real-time orderbook monitoring
- Book ticker updates
- Spread analysis
- Basic trading opportunity detection

## Prerequisites

- Node.js (v12 or higher)
- npm (Node Package Manager)
- Binance account with API access

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with your Binance API credentials:
   ```
   BINANCE_API_KEY=your_api_key
   BINANCE_API_SECRET=your_api_secret
   ```

## Usage

Run the application:
```bash
node src/index.js
```

The application will:
- Connect to Binance WebSocket for orderbook updates
- Monitor book ticker data
- Calculate and display spreads
- Alert on potential trading opportunities

## Configuration

You can modify the following parameters in `src/index.js`:
- `SPREAD_THRESHOLD`: Minimum spread percentage to trigger trading alerts
- Trading pairs in the WebSocket subscriptions

## Error Handling

The application includes basic error handling for:
- Uncaught exceptions
- Unhandled promise rejections
- WebSocket connection issues

## Security Notes

- Never commit your `.env` file
- Keep your API keys secure
- Use API keys with appropriate permissions (read-only if possible) 