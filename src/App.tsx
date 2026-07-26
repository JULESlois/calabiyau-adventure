import GameCanvas from './components/GameCanvas';

export default function App() {
  return (
    <div className="app">
      <div className="game-shell">
        <GameCanvas />
      </div>
      <div className="footer-hint">
        <b>A/D</b> 移动 · <b>空格/W</b> 跳跃(二段) · <b>J</b> 射击 · <b>K</b> 近战 · <b>L</b> 技能 ·{' '}
        <b>Shift</b> 弦化(纸片形态) · <b>Q</b> 切换角色 · <b>S+跳</b> 下落平台 · <b>Esc</b> 暂停 · <b>M</b> 静音
        &nbsp;|&nbsp; 卡拉比丘同人作品,非官方
      </div>
    </div>
  );
}
