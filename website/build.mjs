import {writePortfolio} from './portfolio.mjs';
if (process.argv.length===2) {
  console.log('Built data-free portfolio: '+writePortfolio().join(', '));
} else if (process.argv.length===3 && process.argv[2]==='--local-data') {
  await import('./build-local.mjs');
} else {
  throw Error('Usage: node build.mjs [--local-data]');
}
