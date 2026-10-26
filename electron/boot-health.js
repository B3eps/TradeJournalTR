const http = require('http');

/** Only the server started by this Electron process may satisfy readiness. */
function waitForServer(url, expectedToken, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const tryOnce = () => {
      if (settled) return;
      const req = http.get(url, {
        timeout: 2000,
        headers: { 'x-trade-gunlugu-boot-token': expectedToken },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) {
            done(new Error('Beklenmeyen sunucu yanıtı'));
            req.destroy();
          }
        });
        res.on('end', () => {
          try {
            const health = JSON.parse(body);
            if (res.statusCode === 200 && health.status === 'ok') {
              done();
              return;
            }
          } catch { /* another service may answer on the port */ }
          done(new Error('8471 portu başka bir uygulama tarafından kullanılıyor veya sunucu kimliği doğrulanamadı'));
        });
      });
      req.on('timeout', () => req.destroy(new Error('Sunucu yanıt vermiyor')));
      req.on('error', (err) => {
        if (settled) return;
        if (Date.now() >= deadline) done(new Error(`Sunucu zamanında başlamadı: ${err.message}`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

module.exports = { waitForServer };
