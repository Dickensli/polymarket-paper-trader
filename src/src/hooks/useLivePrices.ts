import { useEffect, useState, useRef } from 'react';

const POLYMARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export interface LivePriceMessage {
  asset_id: string;
  price: number;
}

/**
 * A hook to subscribe to real-time Polymarket prices for given token IDs.
 * 
 * @param tokenIds Array of CLOB token IDs to subscribe to. 
 *                 When tokenIds change, it will automatically resubscribe.
 * @returns A mapping of token_id to its current latest price (midpoint or last trade).
 */
export function useLivePrices(tokenIds: string[]) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!tokenIds || tokenIds.length === 0) {
      return;
    }

    // Initialize WebSocket connection
    const ws = new WebSocket(POLYMARKET_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to the provided token IDs
      ws.send(
        JSON.stringify({
          assets_ids: tokenIds,
          type: 'market',
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Polymarket WS usually returns an array of price updates
        if (Array.isArray(data)) {
          setPrices((prev) => {
            const newPrices = { ...prev };
            let hasChanges = false;
            
            data.forEach((update: any) => {
              if (update.asset_id) {
                let price: number | null = null;
                
                const bestBid = update.bids && update.bids.length > 0
                  ? Math.max(...update.bids.map((b: any) => Number(b.price)).filter((p: number) => !isNaN(p)))
                  : null;
                const bestAsk = update.asks && update.asks.length > 0
                  ? Math.min(...update.asks.map((a: any) => Number(a.price)).filter((p: number) => !isNaN(p)))
                  : null;
                
                if (bestBid !== null && bestAsk !== null) {
                  price = (bestBid + bestAsk) / 2;
                } else if (update.last_trade_price !== undefined && update.last_trade_price !== null && update.last_trade_price !== '') {
                  price = Number(update.last_trade_price);
                } else if (update.price !== undefined && update.price !== null && update.price !== '') {
                  price = Number(update.price);
                }
                
                if (price !== null && !isNaN(price)) {
                  newPrices[update.asset_id] = price;
                  hasChanges = true;
                }
              }
            });
            
            return hasChanges ? newPrices : prev;
          });
        }
      } catch (err) {
        console.error('Error parsing live price message', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    // Cleanup: Unsubscribe and close connection on unmount or tokenIds change
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        // Unsubscribe payload (if supported, otherwise just close)
        // Some APIs require sending an unsubscribe command.
        // We'll just close the socket for simplicity.
        ws.close();
      }
    };
  }, [JSON.stringify(tokenIds)]); // serialize array to avoid infinite loops on re-renders

  return prices;
}
