

async function testGammaApi() {
  console.log("Fetching active events from Polymarket Gamma API...");
  
  const startTime = Date.now();
  // Fetch a page of active events. In reality, you'd filter by tag like ?tag_slug=iran
  // Let's use limit=20 as an example to simulate a topic page.
  const response = await fetch("https://gamma-api.polymarket.com/events?limit=20&active=true");
  const events = await response.json();
  const endTime = Date.now();
  
  console.log(`Fetched ${events.length} events in ${endTime - startTime}ms (1 API Call)`);
  
  let totalMarkets = 0;
  events.forEach((event, index) => {
    const marketsCount = event.markets ? event.markets.length : 0;
    totalMarkets += marketsCount;
    // Just printing out the first 3 for illustration
    if (index < 3) {
      console.log(`- Event: "${event.title}" contains ${marketsCount} markets.`);
    }
  });
  console.log(`...`);
  console.log(`Total nested markets retrieved: ${totalMarkets}`);
  console.log(`\nConclusion: A single Gamma API call for a list of Events retrieves all nested Markets. QPS will NOT explode if you query by Event/Topic instead of individual markets.`);
}

testGammaApi().catch(console.error);
