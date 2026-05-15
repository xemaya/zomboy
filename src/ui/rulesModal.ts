export function renderRulesModal(
  root: HTMLElement,
  open: boolean,
  onClose: () => void,
) {
  root.innerHTML = "";
  if (!open) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) onClose();
  });

  const sheet = document.createElement("div");
  sheet.className = "rules-sheet";
  sheet.innerHTML = `
    <header class="rules-head">
      <h2>ZOM·BOY+ 规则</h2>
      <button class="rules-close" id="rules-close" aria-label="关闭">×</button>
    </header>
    <div class="rules-body">
      <section>
        <h3>🎮 30 秒上手</h3>
        <ul>
          <li>两个人轮流坐一起玩：一边管 <b>4 个蓝色小人</b>（幸存者），一边管 <b>僵尸大军</b>。</li>
          <li>谁先拿到 <b>4 分</b> 谁赢。幸存者靠 <b>跳杀僵尸</b> 加分，僵尸靠 <b>感染小人</b> 加分。</li>
          <li>好玩的地方：两边节奏完全不一样——人能斜着走、还会跳杀；僵尸只能直走，但可以无限增兵把你围死。😈</li>
        </ul>
      </section>

      <section>
        <h3>🏃 人类怎么玩</h3>
        <ul>
          <li>每回合挑 <b>1 个小人走 1 格</b>，上下左右、斜着走都行。</li>
          <li>绝技 <b>跳杀</b>：只要有僵尸贴在你身边（8 个方向都算），而且 <b>它背后那格是空的</b>，你就能像跳棋一样跳过去，把它当场吃掉，<b>+1 分</b>！</li>
          <li>举个例子：僵尸贴在你右边，僵尸再往右那格空着 → 你一跳，僵尸没了，你站到了它原来身后。✨</li>
          <li>走到 <b>房子</b> 上会立刻停下，并抽一张神秘事件卡（往下看）。</li>
        </ul>
      </section>

      <section>
        <h3>🧟 僵尸怎么玩</h3>
        <ul>
          <li>每回合二选一：</li>
          <li><b>① 增兵</b>：点任意空地，凭空冒出 1 只新僵尸（库存 -1，开局有 9 只可放）。</li>
          <li><b>② 进军</b>：移动 <b>2 步</b>——可以让同 1 只僵尸走两次，也可以两只各走一次。</li>
          <li>注意：僵尸只能 <b>上下左右</b> 走，<b>不能斜走</b>，所以包围要靠人多。</li>
          <li>9 只僵尸全放完后，就不能再增兵了——只能用 <b>移动 2 步</b> 慢慢收网。</li>
        </ul>
      </section>

      <section>
        <h3>☠️ 小心被感染！</h3>
        <ul>
          <li>每个回合一结束就结算：如果某个小人的 <b>上下左右</b>（斜的不算！）紧贴着 <b>2 只或更多僵尸</b>，他当场被感染。</li>
          <li>结果：小人没了，<b>僵尸 +1 分</b>；要是库存还有僵尸，原地立刻再冒一只出来补位。</li>
          <li>所以别让你的小人三面贴墙、两边夹僵尸——走位是保命关键。</li>
        </ul>
      </section>

      <section>
        <h3>🎁 房子里有惊喜</h3>
        <ul>
          <li>开局洗好 <b>5 张</b> 事件卡：鬼魂 ×2、靴子 ×2、咖啡 ×1。踩房子才抽，抽完就翻什么算什么。</li>
          <li><b>鬼魂 👻</b>：把任意 1 只僵尸<b>永久驱散</b>——它从场上彻底消失、也不回库存。强力解围！</li>
          <li><b>靴子 👟</b>：立刻让任意 1 个小人再多走 1 格。</li>
          <li><b>咖啡 ☕</b>：立刻让任意 1 个小人连走 2 格——往往能凑出一记跳杀！</li>
          <li>每个房子只能用 <b>一次</b>，用过就变普通地板了。</li>
        </ul>
      </section>

      <section>
        <h3>🗺️ 关于地图</h3>
        <ul>
          <li>棋盘 <b>8×8</b>。4 个小人开局站在四个角，僵尸开局场上 0 只、库存 9 只。</li>
          <li><b>石头</b> 谁都进不去，绕着走。</li>
          <li>地图保证四通八达，不会有人被堵死出不来。</li>
        </ul>
      </section>
    </div>
  `;
  backdrop.appendChild(sheet);
  root.appendChild(backdrop);
  sheet.querySelector<HTMLButtonElement>("#rules-close")?.addEventListener("click", onClose);
}
