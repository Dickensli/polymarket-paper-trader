const WebSocket = require('ws');

const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

ws.on('open', () => {
  console.log('Connected to WS');
  ws.send(JSON.stringify({
    assets_ids: ["28182404005967940652495463228537840901055649726248190462854914416579180110833"],
    type: "market"
  }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  setTimeout(() => process.exit(0), 1000); // exit after first message
});

ws.on('error', console.error);
