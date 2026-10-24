const { createClient } = require('@supabase/supabase-js');
const client = createClient('https://yzwwoahgynzvcnsvqmrr.supabase.co', 'sb_publishable_H2t-F2IAZnKPeMEMFiYH-g_USbzXscM');

async function test() {
  const { data, error } = await client.from('orders').insert([
    {
      order_number: 'TEST-001',
      store_name: 'Test Store',
      delivery_date: '2026-10-24',
      total_amount: 100000,
      items: [{ id: 1, name: 'Item 1', quantity: 2, price: 50000 }],
      status: 'planned'
    }
  ]).select();

  console.log('Insert result:', { data, error });

  if (data && data.length) {
    const { error: delErr } = await client.from('orders').delete().eq('id', data[0].id);
    console.log('Delete result:', delErr);
  }
}
test();
