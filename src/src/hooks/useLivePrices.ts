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
              if (update.asset_id && update.price !== undefined) {
                newPrices[update.asset_id] = Number(update.price);
                hasChanges = true;
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
