const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('response', response => {
    if (!response.ok()) {
      console.log(`Failed to load ${response.url()}: ${response.status()}`);
    }
  });
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  
  const urls = ['http://localhost:3000/nrc'];
  
  for (const url of urls) {
    console.log(`\nTesting ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2' });
  }
  
  await browser.close();
})();
