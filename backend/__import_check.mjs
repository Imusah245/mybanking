import * as m from './src/services/bankService.js';

const r = m.default;
console.log('named listTransactions:', typeof m.listTransactions);
console.log('named getTransactionForUser:', typeof m.getTransactionForUser);
console.log('default.listTransactions:', typeof r.listTransactions);
console.log('default.getTransactionForUser:', typeof r.getTransactionForUser);
console.log('default keys:', Object.keys(r).join(','));
