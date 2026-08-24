(() => {
  const root = document.querySelector("[data-site-footer]");
  if (!root) return;

  root.outerHTML = `
<footer class="site-footer" aria-label="Website footer">
  <div class="ds-shell">
    <div class="footer-brand">
      <span class="footer-mark" aria-hidden="true"></span>
      <div><strong>Iman Cleaning Service LLC</strong><span>Residential &amp; commercial cleaning</span></div>
    </div>
    <div class="footer-grid">
      <div class="footer-cell">
        <span class="footer-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/></svg></span>
        <h4>Email us</h4>
        <p><a href="mailto:Info@imancleaningservice.com">Info@imancleaningservice.com</a></p>
      </div>
      <div class="footer-cell">
        <span class="footer-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg></span>
        <h4>Service area</h4>
        <p><a href="./areas.html">Queens, Brooklyn, Manhattan, Staten Island, and the Bronx</a></p>
      </div>
      <div class="footer-cell">
        <span class="footer-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3l1.5 4.5L7.5 10a12 12 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z"/></svg></span>
        <h4>Call us</h4>
        <p><a href="tel:+19298034053">929-803-4053</a></p>
      </div>
      <div class="footer-cell">
        <span class="footer-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></span>
        <h4>Business hours</h4>
        <p>Open 24 hours · 7 days a week</p>
      </div>
    </div>
    <div class="footer-service-base">
      <h4>Based in Queens, New York</h4>
      <p>Queens, Brooklyn, Manhattan, Staten Island, and the Bronx</p>
      <p><a href="tel:+19298034053">929-803-4053</a> · Open 24 hours · 7 days a week</p>
    </div>
    <div class="footer-follow">
      <h4>Follow us for more</h4>
      <div class="social-row">
        <a class="social-ico" href="https://www.instagram.com/imancleaningservicellc/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" style="background: radial-gradient(circle at 30% 110%, #ffd35c 0%, #ff9a4d 22%, #fd3f6c 46%, #d534b8 70%, #3f5cff 100%); color: #fff;"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.8 3h8.4A4.8 4.8 0 0 1 21 7.8v8.4A4.8 4.8 0 0 1 16.2 21H7.8A4.8 4.8 0 0 1 3 16.2V7.8A4.8 4.8 0 0 1 7.8 3Zm0 1.8A3 3 0 0 0 4.8 7.8v8.4a3 3 0 0 0 3 3h8.4a3 3 0 0 0 3-3V7.8a3 3 0 0 0-3-3H7.8Zm8.9 1.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z"/></svg></a>
        <a class="social-ico" href="https://www.facebook.com/Imancleaningservicellc/" target="_blank" rel="noopener noreferrer" aria-label="Facebook" style="background: #1877f2; color: #fff;"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.6 1.6-1.6H16V4.8c-.2 0-.9-.1-1.8-.1-2.7 0-4.3 1.6-4.3 4.5V11H7.5v3h2.4v7h3.6Z"/></svg></a>
        <a class="social-ico" href="https://www.youtube.com/@ImanCleaningServiceLLC" target="_blank" rel="noopener noreferrer" aria-label="YouTube" style="background: #ff0000; color: #fff;"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a2.9 2.9 0 0 0-2-2A34.6 34.6 0 0 0 12 4.8a34.6 34.6 0 0 0-7.6.4 2.9 2.9 0 0 0-2 2A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 2.9 2.9 0 0 0 2 2 34.6 34.6 0 0 0 7.6.4 34.6 34.6 0 0 0 7.6-.4 2.9 2.9 0 0 0 2-2A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z"/></svg></a>
        <a class="social-ico" href="https://www.tiktok.com/@imancleaningservicellc" target="_blank" rel="noopener noreferrer" aria-label="TikTok" style="background: #111; color: #fff;"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.6 3c.3 2 1.5 3.5 3.4 4.1v2.7a6.7 6.7 0 0 1-3.4-1.1v6.3a5 5 0 1 1-4.1-4.9v2.8a2.2 2.2 0 1 0 1.4 2V3h2.7Z"/></svg></a>
        <a class="social-ico is-google" href="https://share.google/EAX7wC22J4PyMKcNx" target="_blank" rel="noopener noreferrer" aria-label="Google Business Profile" style="background: #fff; color: #fff;"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z"/><path fill="#FBBC04" d="M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z"/></svg></a>
      </div>
    </div>
    <div class="footer-bottom"><span>© 2026 Iman Cleaning Service LLC. All rights reserved.</span><nav class="footer-legal" aria-label="Legal"><a href="./careers.html">Careers</a><a href="./privacy-policy.html">Privacy Policy</a><a href="./sms-terms.html">SMS Terms</a></nav></div>
  </div>
</footer>`;
})();
