// 警報お知らせくん v1.0.16
// 台風Tabのカード背景色は「台風」だけに付与する。
// 熱帯低気圧・温帯低気圧は通常カード背景に戻す。
(() => {
  const originalRenderCycloneCard = renderCycloneCard;

  renderCycloneCard = function(item){
    const card = originalRenderCycloneCard(item);
    const typeText = [item?.className, item?.intensity].filter(Boolean).join(" ");
    const isTyphoon = !item?.ended && /台風/.test(typeText);

    card.classList.toggle("isTyphoon", isTyphoon);
    card.classList.toggle("isNonTyphoon", !isTyphoon);
    return card;
  };

  const style = document.createElement("style");
  style.textContent = `
    .card.cyclone.isTyphoon{
      background:#541b20 !important;
      opacity:1 !important;
    }
    .card.cyclone.isNonTyphoon{
      background:var(--panel) !important;
      opacity:1 !important;
    }
    @media (prefers-color-scheme: light){
      .card.cyclone.isTyphoon{
        background:#fee2e2 !important;
      }
      .card.cyclone.isNonTyphoon{
        background:var(--panel) !important;
      }
    }
  `;
  document.head.appendChild(style);
})();
