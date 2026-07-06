// ── Init ────────────────────────────────────────────────
function renderAll() {
  renderDaily();
  renderMonthly();
  renderConsumables();
  renderInventory();
  if (tabUnlocked.salary) renderSalary();
  if (tabUnlocked.settings) renderTeacherList();
  var rDate = document.getElementById('inv-restock-date');
  if (rDate && !rDate.value) rDate.value = invFmtDate(new Date());
}

initMonth();
// 等頁面完全載入才啟動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(loadData, 300);
  });
} else {
  setTimeout(loadData, 300);
}
