import { BinancePriceService } from '../modules/binance/binance-price.service';
import { BinanceWsService } from '../modules/binance/binance-ws.service';

(() => {
  const wsService = new BinanceWsService();
  const priceService = new BinancePriceService(wsService);
  priceService.onModuleInit();

  console.log('Waiting for ticks...');

  const interval = setInterval(() => {
    const snapshot = priceService.getSnapshot();
    console.log(snapshot);
  }, 2_000);

  setTimeout(() => {
    clearInterval(interval);
    priceService.onModuleDestroy();
    wsService.onModuleDestroy();
    console.log('Smoke test complete');
    process.exit(0);
  }, 20_000);
})();
