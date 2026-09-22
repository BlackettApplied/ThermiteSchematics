/** Static, self-contained viewer. Authored labels are never interpolated into JavaScript. */
export const PACKET_VIEWER_SCRIPT = String.raw`
(() => {
  const search = document.getElementById('packet-search');
  const picker = document.getElementById('packet-sheet');
  const status = document.getElementById('packet-status');
  const sheets = Array.from(document.querySelectorAll('main > section'));
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    sheets.forEach(sheet => {
      const match = !query || sheet.dataset.search.toLocaleLowerCase().includes(query);
      sheet.hidden = !match;
      if (match) count++;
    });
    status.textContent = count + ' of ' + sheets.length + ' sheets shown. Printing always includes the complete packet.';
  }
  function go(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;
    search.value = '';
    filter();
    picker.value = id;
    sheet.scrollIntoView({block:'start'});
    sheet.focus({preventScroll:true});
  }
  search.addEventListener('input',filter);
  picker.addEventListener('change',() => go(picker.value));
  document.getElementById('packet-print').addEventListener('click',() => window.print());
  document.getElementById('packet-size').addEventListener('change',event => {
    document.querySelector('main').classList.toggle('actual-size', event.target.checked);
  });
  document.addEventListener('click',event => {
    const link = event.target.closest('a[href^="#sheet-"]');
    if (!link) return;
    event.preventDefault();
    go(link.getAttribute('href').slice(1));
  });
  filter();
})();`;
