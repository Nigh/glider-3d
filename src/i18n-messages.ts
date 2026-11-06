// Chinese source text is the stable key; names and IDs in saved aircraft stay unchanged.
import { laboratoryMessages } from './laboratory-messages';
export const messages: Record<string, readonly [string, string]> = {
 ...laboratoryMessages,
 "垂直速度": ["Vertical velocity", "鉛直速度"],
 "实时杆量": ["Live control inputs", "現在の操縦入力"],
 "此记录未保存负载曲线": ["This recording has no saved load curves", "この記録には負荷曲線が保存されていません"],
 "飞行记录包含无效负载": ["Invalid recorded wing loads", "記録の翼面負荷が無効です"],
 "回放时间轴": ["Replay timeline","リプレイのタイムライン"],
 "回放进度": ["Replay position","リプレイ位置"],
 "翼面负载曲线": ["Wing load curves","翼面負荷曲線"],

 "正在跳转回放…": ["Seeking replay…","リプレイ位置を移動中…"],

 "G值": ["G load","G荷重"],
 "G值曲线": ["G load curve","G荷重曲線"],
 "最大G值": ["Maximum G load","最大G荷重"],
 "G值为重心处比力大小，包含发射与接触载荷；静止承重为1G，自由落体为0G。": ["G load is the magnitude of proper acceleration at the CG, including launch and contact loads; supported rest is 1 G and free fall is 0 G.","G荷重は重心での比力の大きさです。発射・接触荷重を含み、静止支持時は1 G、自由落下時は0 Gです。"],
 "仅拖动圆形手柄调整顶点或同时移动根弦、梢弦两端；翼面和线段不响应拖动。手柄过近时自动外移，虚线连接真实位置。按住 Ctrl 自由微调。数字输入可精确调整顶点。": ["Drag only circular handles to adjust vertices or both ends of the root/tip chord; wings and lines do not respond to dragging. Nearby handles move outward with dotted leaders to their true positions. Hold Ctrl for fine adjustment, or use numeric inputs.","頂点や根元・翼端の両端は円形ハンドルのみで調整します。翼面や線はドラッグに反応しません。近いハンドルは外へ移動し、点線で実位置を示します。Ctrlで微調整、数値入力で精密に編集できます。"],
 "拖动顶点或根弦、梢弦的圆形手柄调整翼型。按住 Ctrl 取消吸附。增加面积降低翼载荷，但增加重量与阻力。": ["Drag the circular vertex or chord handles. Hold Ctrl to disable snapping. More area lowers wing loading but adds weight and drag.","頂点や翼弦の円形ハンドルをドラッグします。Ctrlで吸着を解除。面積を増やすと翼面荷重は下がりますが、重量と抗力が増えます。"],
 "拖动顶点或根弦、梢弦的圆形手柄调整翼型。按住 Ctrl 取消吸附。增大尾翼或后移安装位置，通常提高俯仰稳定性。": ["Drag the circular vertex or chord handles. Hold Ctrl to disable snapping. A larger tail or a rearward mount usually improves pitch stability.","頂点や翼弦の円形ハンドルをドラッグします。Ctrlで吸着を解除。尾翼の拡大や後方への移動は通常ピッチ安定性を高めます。"],
 "侧视拖动顶点或根弦、梢弦的圆形手柄。按住 Ctrl 取消吸附。垂直尾翼提供偏航恢复力矩，太小容易偏离航向。": ["In side view, drag the circular vertex or chord handles. Hold Ctrl to disable snapping. The vertical tail restores heading; too little area allows drift.","側面で頂点や翼弦の円形ハンドルをドラッグします。Ctrlで吸着を解除。垂直尾翼は偏航を戻す力を生み、小さすぎると進路が乱れます。"],
 "导入回放": ["Import replay", "リプレイをインポート"],
 "导出回放": ["Export replay", "リプレイをエクスポート"],
 "回放结束": ["Replay finished", "リプレイ終了"],
 "回放文件超过 16 MB": ["Replay file exceeds 16 MB", "リプレイファイルは16 MBを超えています"],
 "回放文件格式无效": ["Invalid replay file format", "リプレイファイルの形式が無効です"],
 "回放物理版本不匹配": ["Replay physics version does not match", "リプレイの物理バージョンが一致しません"],
 "回放地图不匹配": ["Replay map does not match", "リプレイのマップが一致しません"],
 "能耗纵轴按正常飞行缩放；擦水与离群峰值以顶部三角标记，悬停查看原值。": ["Energy cost scale follows normal flight; skimming and outlier peaks are marked by top triangles. Hover for raw values.", "エネルギー消費軸は通常飛行に合わせて調整します。水面接触や外れ値は上端の三角で示し、ホバーで元の値を表示します。"],
 "低空分": ["Low flight points", "低空スコア"],
 "速度分": ["Speed points", "速度スコア"],
 "超高扣分": ["Height penalty", "高度超過減点"],
 "逐门得分": ["Checkpoint points", "各ゲートのスコア"],
 "导出": ["Export", "エクスポート"],
 "W / S 俯仰 · A / D 滚转 · Q / E 偏航 · X 鼠标操纵 · C 镜头 · Space 开始/暂停": ["W / S pitch · A / D roll · Q / E yaw · X mouse stick · C camera · Space start/pause", "W / S ピッチ · A / D ロール · Q / E ヨー · X マウス操縦 · C カメラ · Space 開始/一時停止"],
 "航迹滑翔比": ["Flight path glide ratio", "飛行経路滑空比"],
 "本次飞行翼面峰值": ["Wing load peaks this flight", "今回の飛行の翼面最大負荷"],
 "50% 中立 · 鼠标吸附中点 · 快捷键每格 5%": ["50% neutral · Mouse snaps to center · Keys step 5%", "50%で中立 · マウスは中央に吸着 · キーは5%刻み"],
 "副翼配平": ["Roll trim", "ロールトリム"],
 "升降舵配平": ["Pitch trim", "ピッチトリム"],
 "配平控制": ["Trim controls", "トリム操作"],
 "配平": ["Trim", "トリム"],
 "杆量与配平": ["Stick & trim", "操縦入力とトリム"],
 "操纵杆": ["Control stick", "操縦桿"],
 "拖动控制俯仰与滚转": ["Drag to control pitch and roll", "ドラッグでピッチとロールを操作"],
 "自动升降舵配平": ["Auto pitch trim", "自動ピッチトリム"],
 "自动升降舵配平（T）": ["Auto pitch trim (T)", "自動ピッチトリム（T）"],
 "自适应杆量": ["Adaptive controls", "構造強度連動の操舵制限"],
 "自适应杆量（Y）": ["Adaptive controls (Y)", "構造強度連動の操舵制限（Y）"],
 "左偏航": ["Yaw left", "左ヨー"],
 "右偏航": ["Yaw right", "右ヨー"],
 "偏航": ["Yaw", "ヨー"],
 "横轴为试飞时间，各曲线使用独立纵轴。": ["The horizontal axis is flight time; each curve has its own vertical scale.", "横軸は飛行時間、各曲線は独立した縦軸を使用。"],
 "飞行数据曲线": ["Flight data curves", "飛行データ曲線"],
 "侧滑角": ["Sideslip", "横滑り角"],
 "速度×升阻比": ["Speed × lift/drag", "速度×揚抗比"],
 "虚拟操纵杆": ["Virtual joystick", "仮想ジョイスティック"],
 "实时气动数据": ["Live aerodynamics", "リアルタイム空力データ"],
 "气动图层": ["Aerodynamics", "空力レイヤー"],
 "翼构方程": [
  "Aero Formula",
  "翼の方程式"
 ],
 "设计与驾驶": [
  "Design & fly",
  "設計と操縦"
 ],
 "能量分配": [
  "Energy distribution",
  "エネルギー配分"
 ],
 "待开始": [
  "Ready",
  "開始前"
 ],
 "助跑供能中": [
  "Launch energy input",
  "助走中のエネルギー入力"
 ],
 "引擎做功计入总量": [
  "Engine work included",
  "エンジンの仕事を含む"
 ],
 "飞行能量账本": [
  "Flight energy balance",
  "飛行エネルギー収支"
 ],
 "点击开始后助跑": [
  "Launch after starting",
  "開始後に助走"
 ],
 "坡道助跑中": [
  "Accelerating down ramp",
  "斜面を助走中"
 ],
 "，沿10 m、3.5°坡道加速至": [
  ", accelerating along a 10 m, 3.5° ramp to",
  "。10 m、3.5°の斜面で加速し、"
 ],
 "m/s。滚转扰动在助跑中平滑加入；离台时建立能量基准，助跑外力供能不计入耗散。": [
  "m/s. Roll disturbance builds smoothly during launch. The energy baseline starts at release; external launch work is not counted as dissipation.",
  "m/sに到達。助走中にロールの乱れを徐々に加えます。離陸時をエネルギー基準とし、助走の外力による仕事は散逸に含めません。"
 ],
 "合计": [
  "Total",
  "合計"
 ],
 "能量预算": [
  "Energy budget",
  "エネルギー収支基準"
 ],
 "动能含平动与转动；耗散含空气、水体阻力与阻尼。引擎做功": [
  "Kinetic energy includes translation and rotation; dissipation includes air and water drag and damping. Engine work",
  "運動エネルギーは並進と回転を含み、散逸は空気・水の抵抗と減衰を含みます。エンジンの仕事"
 ],
 "J · 驾驶员做功": [
  "J · Pilot work",
  "J · 操縦者の仕事"
 ],
 "J · 浮力做功": [
  "J · Buoyancy work",
  "J · 浮力の仕事"
 ],
 "J · 燃油带走": [
  "J · Energy removed with fuel",
  "J · 消費燃料が持ち去るエネルギー"
 ],
 "距离—高度、能量与能耗": [
  "Distance, altitude, energy & consumption",
  "距離・高度・エネルギー・消費"
 ],
 "距离—高度": [
  "Distance–altitude",
  "距離と高度"
 ],
 "真实采样 {p0} 点": [
  "{p0} recorded samples",
  "実測 {p0} 点"
 ],
 "离台后开始采样": [
  "Sampling starts after release",
  "離陸後に記録開始"
 ],
 "开始试飞后采样": [
  "Sampling starts with the flight",
  "試飛開始後に記録"
 ],
 "高度 · 左轴 m": [
  "Altitude · left axis m",
  "高度 · 左軸 m"
 ],
 "剩余机械能 · 右轴 %": [
  "Remaining mechanical energy · right axis %",
  "残存力学的エネルギー · 右軸 %"
 ],
 "实时能耗 · 外右轴 J/m": [
  "Instant energy cost · outer right axis J/m",
  "瞬時エネルギー消費 · 外側右軸 J/m"
 ],
 "实际高度 · m": [
  "Actual altitude · m",
  "実際の高度 · m"
 ],
 "计分高度上限 · 接触表面 +": [
  "Scoring ceiling · contact surface +",
  "得点高度上限 · 接触面 +"
 ],
 "飞行轨迹，水平距离0至{p0}米，高度0至{p1}米{p2}": [
  "Flight path: horizontal distance 0–{p0} m, altitude 0–{p1} m{p2}",
  "飛行経路。水平距離0～{p0} m、高度0～{p1} m{p2}"
 ],
 "；剩余机械能为动能与势能之和占起飞初始能量的百分比，右轴0至{p0}%；实时能耗外右轴0至{p1}焦耳每米": [
  "; remaining mechanical energy is kinetic plus potential energy as a percentage of initial takeoff energy, right axis 0–{p0}%; instant energy cost, outer right axis 0–{p1} J/m",
  "。残存力学的エネルギーは運動・位置エネルギーの和を離陸時のエネルギーで割った割合。右軸0～{p0}%。瞬時消費は外側右軸0～{p1} J/m"
 ],
 "；虚线为沿实际航迹的接触表面加{p0}米计分高度上限": [
  "; dashed line marks the scoring ceiling {p0} m above the contact surface along the actual flight path",
  "。破線は実際の経路の接触面から{p0} m上の得点高度上限"
 ],
 "高度 m": [
  "Altitude m",
  "高度 m"
 ],
 "离台后": [
  "After release, ",
  "離陸後、"
 ],
 "开始试飞后": [
  "After starting the flight, ",
  "試飛開始後、"
 ],
 "每 0.1 s 采样，末点保留实际终止高度。": [
  "sampled every 0.1 s. The last point retains the actual final altitude.",
  "0.1 sごとに記録。最後の点は終了時の実高度です。"
 ],
 "机械能占比 =（动能 + 势能）/ 离台初始能量，动能含转动。实时能耗 = 耗散功率 / 水平速度；无定义时断线，不记作零。": [
  "Mechanical energy ratio = (kinetic + potential energy) / initial release energy; kinetic energy includes rotation. Instant energy cost = dissipation power / horizontal speed. Undefined values leave a gap, not zero.",
  "力学的エネルギー比率 =（運動 + 位置エネルギー）/ 離陸時の初期エネルギー。運動には回転を含みます。瞬時消費 = 散逸出力 / 水平速度。未定義の区間はゼロではなく空白にします。"
 ],
 "距离从出发门后累计，门前采样距离为零。": [
  "Distance accumulates after the start gate; samples before it have zero distance.",
  "距離はスタートゲート通過後に累積し、通過前の記録は距離ゼロです。"
 ],
 "虚线沿每个真实采样位置的地形或河面上方": [
  "The dashed line follows the terrain or river surface at each recorded position, plus",
  "破線は実際の各記録位置の地形または川面から"
 ],
 "m；实际高度高于虚线时超出计分高度。": [
  "m. Flying above it exceeds the scoring ceiling.",
  "m上です。破線より上は得点高度の範囲外です。"
 ],
 "空速": [
  "Airspeed",
  "対気速度"
 ],
 "真实采样": [
  "Recorded samples",
  "実測"
 ],
 "点": [
  "points",
  "点"
 ],
 "空速曲线，试飞时间0至{p0}秒，空速0至{p1}米每秒": [
  "Airspeed chart: simulated flight time 0–{p0} s, airspeed 0–{p1} m/s",
  "対気速度グラフ。飛行時間0～{p0}秒、対気速度0～{p1} m/s"
 ],
 "空速 m/s": [
  "Airspeed m/s",
  "対気速度 m/s"
 ],
 "每 0.1 s 记录真实空速；横轴为开始试飞后的模拟时间，含助跑或跑道滑跑，暂停不计时。": [
  "Actual airspeed sampled every 0.1 s. The horizontal axis is simulated time since starting, including launch or runway roll; pauses do not count.",
  "実際の対気速度を0.1 sごとに記録。横軸は試飛開始後のシミュレーション時間で、助走・滑走を含み、一時停止は含みません。"
 ],
 "设计": [
  "Design",
  "設計"
 ],
 "试飞": [
  "Test flight",
  "試飛"
 ],
 "语言": [
  "Language",
  "言語"
 ],
 "中文": [
  "中文",
  "中文"
 ],
 "日本語": [
  "日本語",
  "日本語"
 ],
 "画质": [
  "Quality",
  "画質"
 ],
 "性能": [
  "Performance",
  "性能"
 ],
 "不同飞机，": [
  "Different aircraft,",
  "機体を変えて、"
 ],
 "不同挑战。": [
  "different challenges.",
  "挑戦を変える。"
 ],
 "选择挑战，进入对应飞机工坊。": [
  "Choose a challenge and open its aircraft workshop.",
  "挑戦を選んで、機体工房を開きます。"
 ],
 "湖面比距离，山谷竞速，低空贴地闯关。": [
  "Glide over the lake, race down a valley, or score at low altitude.",
  "湖上で距離を競い、山谷で速さを競い、低空で得点を狙います。"
 ],
 "鸟人间挑战": [
  "Birdman challenge",
  "鳥人間チャレンジ"
 ],
 "无动力 · 湖面距离": [
  "Unpowered · distance over water",
  "無動力 · 湖上の飛距離"
 ],
 "高山速降": [
  "Alpine downhill",
  "山岳ダウンヒル"
 ],
 "山顶弹射 · 山谷竞速": [
  "Summit catapult · valley time trial",
  "山頂射出 · 渓谷タイムアタック"
 ],
 "低空飞行": [
  "Low-altitude flight",
  "低空飛行"
 ],
 "跑道起飞 · 河谷计分": [
  "Runway takeoff · river-valley scoring",
  "滑走路離陸 · 河谷で得点"
 ],
 "W / S 俯仰 · A / D 滚转 · Q / E 偏航 · 1 / 2 油门": [
  "W / S pitch · A / D roll · Q / E yaw · 1 / 2 throttle",
  "W / S ピッチ · A / D ロール · Q / E ヨー · 1 / 2 スロットル"
 ],
 "湖风 01 / 均衡型": [
  "Lakewind 01 / Balanced",
  "湖風 01 / バランス型"
 ],
 "14.0 m 翼展": [
  "14.0 m wingspan",
  "翼幅14.0 m"
 ],
 "参数化轻型滑空机": [
  "Parametric light glider",
  "パラメトリック軽量滑空機"
 ],
 "飞机工坊": [
  "Aircraft workshop",
  "機体工房"
 ],
 "· 调整设计，前往挑战。": [
  "· Adjust the design, then fly the challenge.",
  "· 設計を調整して挑戦へ。"
 ],
 "机库": [
  "Hangar",
  "格納庫"
 ],
 "保存": [
  "Save",
  "保存"
 ],
 "撤销": [
  "Undo",
  "元に戻す"
 ],
 "重做": [
  "Redo",
  "やり直す"
 ],
 "重置设计": [
  "Reset design",
  "設計をリセット"
 ],
 "机身": [
  "Fuselage",
  "胴体"
 ],
 "主翼": [
  "Main wing",
  "主翼"
 ],
 "水平尾翼": [
  "Horizontal tail",
  "水平尾翼"
 ],
 "垂直尾翼": [
  "Vertical tail",
  "垂直尾翼"
 ],
 "组装": [
  "Assembly",
  "組立"
 ],
 "动力": [
  "Propulsion",
  "動力"
 ],
 "位置与配平": [
  "Position & trim",
  "配置とトリム"
 ],
 "{part}设计": [
  "{part} design",
  "{part}の設計"
 ],
 "鸟人间专用：仅垂尾具有控制面；俯仰与滚转靠驾驶员移动重心。": [
  "Birdman: only the vertical tail has a control surface; pitch and roll use pilot weight shift.",
  "鳥人間では垂直尾翼のみが舵面を持ち、ピッチとロールは操縦者の重心移動で操作します。"
 ],
 "主翼副翼与平尾升降舵控制姿态；驾驶员由流线座舱包覆。": [
  "Ailerons and elevator control attitude; the pilot sits inside a streamlined cockpit.",
  "副翼と昇降舵で姿勢を操作し、操縦者は流線型のコックピットに収まります。"
 ],
 "切换挑战保留当前飞机。仅进入鸟人间时，不符合规则的飞机恢复默认。重置设计会载入当前挑战的默认飞机。": [
  "Changing challenges keeps your aircraft. Only entering Birdman replaces an ineligible aircraft with the default. Reset design loads the current challenge's default aircraft.",
  "挑戦を変えても現在の機体を維持します。鳥人間に入るときだけ、ルール外の機体を初期機体に戻します。設計リセットでは現在の挑戦の初期機体を読み込みます。"
 ],
 "机头端点": [
  "Nose endpoint",
  "機首端点"
 ],
 "机尾端点": [
  "Tail endpoint",
  "尾部端点"
 ],
 "机身长度": [
  "Fuselage length",
  "胴体長"
 ],
 "· 驾驶员": [
  "· Pilot",
  "· 操縦者"
 ],
 "端点以机身局部 X 为准。移动一端，另一端不动；在组装视图也可直接拖动。驾驶舱及尾翼必须留在机身支撑范围内。": [
  "Endpoints use local fuselage X. Moving one end leaves the other fixed; drag them in Assembly too. The cockpit and tail mounts must remain supported by the fuselage.",
  "端点は胴体ローカルXで指定します。一端を動かしても他端は固定です。組立画面でもドラッグできます。コックピットと尾翼の取付点は胴体の支持範囲に収めます。"
 ],
 "驾驶舱位置": [
  "Cockpit position",
  "コックピット位置"
 ],
 "正值向机头移动。固定": [
  "Positive moves toward the nose. The fixed",
  "正の値で機首側へ移動。固定の"
 ],
 "kg 驾驶员随驾驶舱改变重心；移动范围保持机身支撑。": [
  "kg pilot moves with the cockpit, shifting the center of gravity. Travel stays within fuselage support.",
  "kgの操縦者がコックピットとともに動き、重心が変わります。移動は胴体の支持範囲内です。"
 ],
 "喷气引擎": [
  "Jet engine",
  "ジェットエンジン"
 ],
 "无引擎": [
  "No engine",
  "エンジンなし"
 ],
 "单发 · Jet 01": [
  "Single · Jet 01",
  "単発 · Jet 01"
 ],
 "双发 · Jet 01": [
  "Twin · Jet 01",
  "双発 · Jet 01"
 ],
 "负值在下，正值在上。可用范围：{p0}。自动跳过机身重叠区；单发居中，双发固定在机身两侧。": [
  "Negative is below, positive above. Available ranges: {p0}. Fuselage overlap is skipped automatically; single engines are centered and twin engines mount on both sides.",
  "負は下、正は上。使用範囲：{p0}。胴体との重複域は自動で避けます。単発は中央、双発は胴体の両側に固定します。"
 ],
 "{p0} 至 {p1} m": [
  "{p0} to {p1} m",
  "{p0}～{p1} m"
 ],
 "未安装引擎，油箱已自动取消。": [
  "No engine installed; the fuel tank has been removed.",
  "エンジン未搭載のため、燃料タンクを外しました。"
 ],
 "精确值": [
  "precise value",
  "精密値"
 ],
 "副翼弦长比例": [
  "Aileron chord ratio",
  "副翼の弦長比"
 ],
 "升降舵弦长比例": [
  "Elevator chord ratio",
  "昇降舵の弦長比"
 ],
 "方向舵弦长比例": [
  "Rudder chord ratio",
  "方向舵の弦長比"
 ],
 "1 为全动垂尾。": [
  "1 makes the entire vertical tail movable.",
  "1で全遊動垂直尾翼になります。"
 ],
 "控制面占翼面弦长的比例。": [
  "Control-surface chord as a fraction of wing chord.",
  "翼の弦長に対する舵面の弦長の割合です。"
 ],
 "选择预设飞机": [
  "Choose a preset",
  "プリセット機を選択"
 ],
 "前往挑战": [
  "Fly challenge",
  "挑戦へ"
 ],
 "轨道": [
  "Orbit",
  "周回"
 ],
 "俯视": [
  "Top",
  "上面"
 ],
 "侧视": [
  "Side",
  "側面"
 ],
 "正视": [
  "Front",
  "正面"
 ],
 "后视": [
  "Rear",
  "背面"
 ],
 "主翼面积": [
  "Main-wing area",
  "主翼面積"
 ],
 "翼展 / 展弦比": [
  "Wingspan / aspect ratio",
  "翼幅 / アスペクト比"
 ],
 "全备质量 · 驾驶员": [
  "All-up mass · Pilot",
  "全備質量 · 操縦者"
 ],
 "支撑": [
  "Support",
  "支持部"
 ],
 "翼载荷": [
  "Wing loading",
  "翼面荷重"
 ],
 "自由空气最佳滑翔比": [
  "Best free-air glide ratio",
  "自由空気中の最大滑空比"
 ],
 "估算失速速度": [
  "Estimated stall speed",
  "推定失速速度"
 ],
 "重心 CG": [
  "Center of gravity CG",
  "重心 CG"
 ],
 "全机升力中心": [
  "Aircraft lift center",
  "全機揚力中心"
 ],
 "无合力": [
  "No resultant force",
  "合力なし"
 ],
 "全机阻力中心": [
  "Aircraft drag center",
  "全機抗力中心"
 ],
 "推力中心": [
  "Thrust center",
  "推力中心"
 ],
 "推力中心X": [
  "Thrust center X",
  "推力中心X"
 ],
 "推力中心Y": [
  "Thrust center Y",
  "推力中心Y"
 ],
 "推力中心Z": [
  "Thrust center Z",
  "推力中心Z"
 ],
 "方向 +X": [
  "Direction +X",
  "方向 +X"
 ],
 "静稳定裕度": [
  "Static margin",
  "静安定余裕"
 ],
 "中性点 X": [
  "Neutral point X",
  "中立点 X"
 ],
 "重心偏后，可能俯仰失稳。": [
  "Aft CG may cause pitch instability.",
  "重心が後ろ寄りで、ピッチが不安定になる場合があります。"
 ],
 "重心偏前，可能难以抬头。": [
  "Forward CG may make nose-up control difficult.",
  "重心が前寄りで、機首上げが難しくなる場合があります。"
 ],
 "正稳定裕度不代表已配平。": [
  "A positive static margin does not guarantee trim.",
  "正の静安定余裕でもトリムは保証されません。"
 ],
 "建议 5–20% MAC；合力中心不表示力矩为零。": [
  "Suggested range: 5–20% MAC. Force centers do not imply zero moment.",
  "目安は5～20% MAC。合力中心はモーメントゼロを意味しません。"
 ],
 "燃油重心范围 · 满油 X": [
  "Fuel CG range · Full fuel X",
  "燃料による重心範囲 · 満タン X"
 ],
 "m · 空油 X": [
  "m · Empty fuel X",
  "m · 空タンク X"
 ],
 "三维连线标出满油圆点与空油菱形；空油仍保留油箱质量。": [
  "The 3D line connects the full-fuel circle and empty-fuel diamond; empty fuel still includes tank mass.",
  "3Dの線は満タンの丸と空タンクのひし形を結びます。空でもタンク質量は残ります。"
 ],
 "三翼气动力预览": [
  "Three-surface aerodynamic preview",
  "3翼面の空力プレビュー"
 ],
 "自由空气 · 无地效 · 空速": [
  "Free air · no ground effect · airspeed",
  "自由空気 · 地面効果なし · 対気速度"
 ],
 "m/s · 机身攻角": [
  "m/s · body angle of attack",
  "m/s · 機体迎角"
 ],
 "° · 侧滑": [
  "° · sideslip",
  "° · 横滑り"
 ],
 "° · 无操纵": [
  "° · no control input",
  "° · 操舵なし"
 ],
 "翼面 / 几何": [
  "Surface / geometry",
  "翼面 / 形状"
 ],
 "有效攻角": [
  "Effective angle of attack",
  "有効迎角"
 ],
 "升 / 侧向力": [
  "Lift / side force",
  "揚力 / 横力"
 ],
 "阻力": [
  "Drag",
  "抗力"
 ],
 "俯仰 / 偏航矩": [
  "Pitch / yaw moment",
  "ピッチ / ヨーモーメント"
 ],
 "气动作用": [
  "aerodynamic action",
  "空力作用"
 ],
 "侧向力": [
  "Side force",
  "横力"
 ],
 "升力": [
  "Lift",
  "揚力"
 ],
 "偏航力矩": [
  "Yaw moment",
  "ヨーモーメント"
 ],
 "俯仰力矩": [
  "Pitch moment",
  "ピッチモーメント"
 ],
 "滑翔距离": [
  "Glide distance",
  "滑空距離"
 ],
 "下降率": [
  "Descent rate",
  "降下率"
 ],
 "离地高度": [
  "Ground clearance",
  "対地高度"
 ],
 "剩余燃料": [
  "Fuel remaining",
  "残燃料"
 ],
 "高度": [
  "Altitude",
  "高度"
 ],
 "总计时": [
  "Elapsed time",
  "総時間"
 ],
 "实时攻角": [
  "Angle of attack",
  "現在の迎角"
 ],
 "实时升阻比": [
  "Lift-to-drag ratio",
  "現在の揚抗比"
 ],
 "实时能耗": [
  "Instant energy cost",
  "瞬時エネルギー消費"
 ],
 "跑道滑跑": [
  "Runway roll",
  "滑走中"
 ],
 "弹射助跑": [
  "Catapult launch",
  "射出助走"
 ],
 "飞行中": [
  "In flight",
  "飛行中"
 ],
 "湖面最远距离": [
  "Longest distance over water",
  "湖上の最長飛距離"
 ],
 "通过出发门后开始计时与计分": [
  "Timing and scoring start after the start gate",
  "スタートゲート通過後に計時・採点開始"
 ],
 "通过出发门后开始计时": [
  "Timing starts after the start gate",
  "スタートゲート通過後に計時開始"
 ],
 "赛道进度 {p0}% · 依次穿过航线检查点": [
  "Course progress {p0}% · pass checkpoints in order",
  "コース進捗 {p0}% · チェックポイントを順番に通過"
 ],
 "攻角过大 · 失速": [
  "Excess angle of attack · stalled",
  "迎角過大 · 失速"
 ],
 "离地": [
  "Clearance",
  "対地"
 ],
 "得分": [
  "Score",
  "得点"
 ],
 "连续超高": [
  "Continuous time above ceiling",
  "連続高度超過"
 ],
 "超出计分高度 · 降低高度": [
  "Above scoring ceiling · descend",
  "得点高度超過 · 高度を下げる"
 ],
 "油门 · 1 增 / 2 减": [
  "Throttle · 1 up / 2 down",
  "スロットル · 1 増 / 2 減"
 ],
 "转速": [
  "RPM",
  "回転数"
 ],
 "% · 推力": [
  "% · Thrust",
  "% · 推力"
 ],
 "N · 余油": [
  "N · Fuel",
  "N · 残燃料"
 ],
 "继续飞行": [
  "Resume flight",
  "飛行を再開"
 ],
 "暂停": [
  "Pause",
  "一時停止"
 ],
 "返回设计": [
  "Back to design",
  "設計へ戻る"
 ],
 "开始试飞": [
  "Start flight",
  "試飛開始"
 ],
 "空格开始 / 暂停 · C 切换视角": [
  "Space starts / pauses · C changes view",
  "スペースで開始 / 停止 · Cで視点切替"
 ],
 "飞行已暂停": [
  "Flight paused",
  "飛行を一時停止中"
 ],
 "继续": [
  "Resume",
  "再開"
 ],
 "俯仰 · W / S": [
  "Pitch · W / S",
  "ピッチ · W / S"
 ],
 " · 前后重心": [
  " · fore/aft weight shift",
  " · 前後の重心移動"
 ],
 "低头": [
  "Nose down",
  "機首下げ"
 ],
 "抬头": [
  "Nose up",
  "機首上げ"
 ],
 "滚转 · A / D": [
  "Roll · A / D",
  "ロール · A / D"
 ],
 " · 左右重心": [
  " · lateral weight shift",
  " · 左右の重心移動"
 ],
 "左滚": [
  "Roll left",
  "左ロール"
 ],
 "右滚": [
  "Roll right",
  "右ロール"
 ],
 "偏航 · Q / E": [
  "Yaw · Q / E",
  "ヨー · Q / E"
 ],
 "左转": [
  "Yaw left",
  "左旋回"
 ],
 "右转": [
  "Yaw right",
  "右旋回"
 ],
 "姿态与结构 ·": [
  "Attitude & structure ·",
  "姿勢と構造 ·"
 ],
 "已断裂 {p0} 次": [
  "{p0} fractures",
  "破断 {p0} 回"
 ],
 "结构完整": [
  "Structure intact",
  "構造健全"
 ],
 "· 极限": [
  "· Limit",
  "· 極限"
 ],
 "结构极限利用率": [
  "Structural limit utilization",
  "構造極限の使用率"
 ],
 "· 弹性限利用率": [
  "· Elastic-limit utilization",
  "· 弾性限使用率"
 ],
 "结构极限": [
  "Structural limit",
  "構造極限"
 ],
 "{name}结构极限利用率": [
  "{name} structural limit utilization",
  "{name}の構造極限使用率"
 ],
 "弹性限": [
  "Elastic limit",
  "弾性限"
 ],
 "连接 {attached} 段 / 脱离 {detached} 段": [
  "{attached} attached / {detached} detached sections",
  "接続 {attached} 区間 / 分離 {detached} 区間"
 ],
 "最大形变": [
  "Maximum deflection",
  "最大変形"
 ],
 "mm · 独立断片": [
  "mm · Separate fragments",
  "mm · 独立破片"
 ],
 "片": [
  "pieces",
  "個"
 ],
 "承力梁已断裂": [
  "Spar fractures:",
  "桁の破断："
 ],
 "次。": [
  "times.",
  "回。"
 ],
 "主体继续飞行；断片独立运动，断片落地不结束主体。": [
  "The main body keeps flying. Fragments move independently; their landing does not end the flight.",
  "本体は飛行を続けます。破片は独立して運動し、破片の着地では飛行は終了しません。"
 ],
 "接近结构极限，减小载荷。": [
  "Near structural limit; reduce load.",
  "構造極限に接近。荷重を下げてください。"
 ],
 "超过等效弹性限。当前仍为线弹性近似，不模拟塑性或真实颤振。": [
  "Equivalent elastic limit exceeded. The model remains linearly elastic; plasticity and real flutter are not simulated.",
  "等価弾性限を超過。モデルは線形弾性のままで、塑性と実際のフラッターは再現しません。"
 ],
 "俯仰": [
  "Pitch",
  "ピッチ"
 ],
 "° · 滚转": [
  "° · Roll",
  "° · ロール"
 ],
 "下沉率": [
  "Sink rate",
  "沈下率"
 ],
 "m/s · 航迹滑翔比": [
  "m/s · Flight-path glide ratio",
  "m/s · 経路の滑空比"
 ],
 "升降舵": [
  "Elevator",
  "昇降舵"
 ],
 "副翼": [
  "Aileron",
  "副翼"
 ],
 "挑战完成": [
  "Challenge complete",
  "挑戦クリア"
 ],
 "挑战未完成": [
  "Challenge incomplete",
  "挑戦未達成"
 ],
 "飞行重放": [
  "Flight replay",
  "飛行リプレイ"
 ],
 "挑战成绩": [
  "Challenge result",
  "挑戦結果"
 ],
 "分": [
  "points",
  "点"
 ],
 "个人最佳": [
  "Personal best",
  "自己ベスト"
 ],
 "暂无": [
  "None yet",
  "記録なし"
 ],
 "到达终点": [
  "Finish reached",
  "ゴール到達"
 ],
 "未通过全部检查点或碰撞地形": [
  "Missed checkpoints or terrain collision",
  "チェックポイント未通過または地形に衝突"
 ],
 "接触湖面": [
  "Water contact",
  "湖面に接触"
 ],
 "达到飞行边界": [
  "Flight boundary reached",
  "飛行境界に到達"
 ],
 "（含助跑）": [
  "(including launch)",
  "（助走を含む）"
 ],
 "平均速度": [
  "Average speed",
  "平均速度"
 ],
 "最高速度": [
  "Maximum speed",
  "最高速度"
 ],
 "最低速度": [
  "Minimum speed",
  "最低速度"
 ],
 "最大高度": [
  "Maximum altitude",
  "最高高度"
 ],
 "输入记录": [
  "Recorded inputs",
  "入力記録"
 ],
 "步 · 60 Hz": [
  "steps · 60 Hz",
  "ステップ · 60 Hz"
 ],
 "结构断裂": [
  "Structural fractures",
  "構造破断"
 ],
 "次 · 独立断片": [
  "fractures · Separate fragments",
  "回 · 独立破片"
 ],
 "片 · 最终结构极限利用率": [
  "pieces · Final structural limit utilization",
  "個 · 最終構造極限使用率"
 ],
 "返回设计改进": [
  "Return to improve design",
  "設計を改良する"
 ],
 "再试一次": [
  "Try again",
  "再挑戦"
 ],
 "再试一次（仅暂停或结算时）": [
  "Try again (only when paused or on results)",
  "再挑戦（一時停止中または結果画面のみ）"
 ],
 "重放飞行": [
  "Replay flight",
  "飛行を再生"
 ],
 "本地机库 ·": [
  "Local hangar ·",
  "ローカル格納庫 ·"
 ],
 "架": [
  "aircraft",
  "機"
 ],
 "关闭": [
  "Close",
  "閉じる"
 ],
 "飞机保存在当前浏览器。同名保存需确认覆盖，新名字新增记录。各架飞机可导出 JSON 备份或分享。": [
  "Aircraft are stored in this browser. Saving the same name asks before overwriting; a new name adds a record. Export each aircraft as JSON to back up or share.",
  "機体はこのブラウザーに保存します。同名保存は確認後に上書きし、新しい名前は別記録として追加します。各機体をJSONで書き出してバックアップ・共有できます。"
 ],
 "导入 JSON": [
  "Import JSON",
  "JSONを読み込む"
 ],
 "机库还没有飞机。先保存你的第一个设计。": [
  "Your hangar is empty. Save your first design.",
  "格納庫は空です。最初の設計を保存してください。"
 ],
 "重命名": [
  "Rename",
  "名前変更"
 ],
 " · 当前飞机": [
  " · Current aircraft",
  " · 現在の機体"
 ],
 "加载": [
  "Load",
  "読み込む"
 ],
 "复制": [
  "Duplicate",
  "複製"
 ],
 "导出 JSON": [
  "Export JSON",
  "JSONを書き出す"
 ],
 "删除“{name}”？此操作不可撤销。": [
  "Delete “{name}”? This cannot be undone.",
  "「{name}」を削除しますか？元に戻せません。"
 ],
 "删除": [
  "Delete",
  "削除"
 ],
 "性能实测": [
  "Measured performance",
  "性能実測"
 ],
 "平均": [
  "Mean",
  "平均"
 ],
 "物理": [
  "Physics",
  "物理"
 ],
 "ms · 渲染提交": [
  "ms · Render submission",
  "ms · 描画送信"
 ],
 "几何": [
  "Geometry",
  "形状"
 ],
 "几何与纹理估算": [
  "Estimated geometry & texture memory",
  "形状・テクスチャの推定メモリー"
 ],
 "不可用": [
  "Unavailable",
  "利用不可"
 ],
 "帧率来自当前环境，不代表真实手机性能。": [
  "Frame rate reflects this environment, not real phone performance.",
  "フレームレートは現在の環境での値で、実機スマートフォンの性能を示しません。"
 ],
 "追尾": [
  "Chase",
  "後方追従"
 ],
 "侧追尾": [
  "Offset chase",
  "斜め後方追従"
 ],
 "侧面": [
  "Side chase",
  "側面追従"
 ],
 "驾驶员": [
  "Pilot",
  "操縦者"
 ],
 "自由": [
  "Free",
  "自由"
 ],
 "势能": [
  "Potential",
  "位置"
 ],
 "动能": [
  "Kinetic",
  "運動"
 ],
 "已耗散": [
  "Dissipated",
  "散逸"
 ],
 "主翼纵向位置": [
  "Main-wing longitudinal position",
  "主翼の前後位置"
 ],
 "水平尾翼位置": [
  "Horizontal-tail position",
  "水平尾翼位置"
 ],
 "垂直尾翼位置": [
  "Vertical-tail position",
  "垂直尾翼位置"
 ],
 "已限制在机身支撑范围内；可先延长机头或机尾。": [
  "Clamped to fuselage support. Extend the nose or tail first for more travel.",
  "胴体の支持範囲に制限しました。範囲を広げるには機首または尾部を延長してください。"
 ],
 "位置必须是有限数值": [
  "Position must be finite",
  "位置は有限値で入力してください"
 ],
 "端点受 3–12 m 机身长度、驾驶舱和尾翼支撑限制。": [
  "Endpoints are limited by the 3–12 m fuselage length and cockpit and tail support.",
  "端点は胴体長3～12 mと、コックピット・尾翼の支持範囲で制限されます。"
 ],
 "端点必须是有限数值": [
  "Endpoint must be finite",
  "端点は有限値で入力してください"
 ],
 "驾驶舱的位置改变重心。过度靠后可能让飞机俯仰失稳。": [
  "Cockpit position moves the CG. Too far aft can cause pitch instability.",
  "コックピット位置で重心が変わります。後ろ寄りすぎるとピッチが不安定になる場合があります。"
 ],
 "拖动四个顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。增加面积降低翼载荷，但增加重量与阻力。": [
  "Drag the four vertices or root-chord 1–4 and tip-chord 2–3 segments. Soft screen-vertical snapping; hold Ctrl to bypass. More area lowers wing loading but adds mass and drag.",
  "4頂点、根弦1–4、翼端弦2–3の線分をドラッグ。画面の縦方向に軽く吸着し、Ctrlで解除します。面積を増やすと翼面荷重が下がり、質量と抗力が増えます。"
 ],
 "拖动顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。增大尾翼或后移安装位置，通常提高俯仰稳定性。": [
  "Drag vertices or root-chord 1–4 and tip-chord 2–3 segments. Soft screen-vertical snapping; hold Ctrl to bypass. A larger or further-aft tail usually improves pitch stability.",
  "頂点、根弦1–4、翼端弦2–3の線分をドラッグ。画面の縦方向に軽く吸着し、Ctrlで解除します。尾翼の拡大や後方配置は通常ピッチ安定性を高めます。"
 ],
 "侧视拖动顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。垂直尾翼提供偏航恢复力矩，太小容易偏离航向。": [
  "Drag vertices or root-chord 1–4 and tip-chord 2–3 segments in side view. Soft screen-vertical snapping; hold Ctrl to bypass. The vertical tail restores yaw; too little area makes heading less stable.",
  "側面で頂点、根弦1–4、翼端弦2–3の線分をドラッグ。画面の縦方向に軽く吸着し、Ctrlで解除します。垂直尾翼はヨーの復元モーメントを生み、小さすぎると進路が不安定になります。"
 ],
 "侧视拖动主翼、尾翼或驾驶舱。主翼高度接近机身时吸附至 0 m，按住 Ctrl 绕过吸附。正 X 朝机头；尾翼位置以翼根中心为准。": [
  "Drag wing, tails or cockpit in side view. Main-wing height snaps to 0 m near the fuselage; hold Ctrl to bypass. +X points toward the nose; tail positions use the root-chord center.",
  "側面で主翼・尾翼・コックピットをドラッグ。主翼高度は胴体付近で0 mに吸着し、Ctrlで解除します。+Xは機首方向、尾翼位置は翼根中央が基準です。"
 ],
 "喷气引擎与油箱参与质量、重心和惯量计算。引擎偏离机身时自动增加支撑。正 X 朝机头。": [
  "Jet engines and tank affect mass, CG and inertia. Supports are added when engines sit away from the fuselage. +X points toward the nose.",
  "ジェットエンジンとタンクは質量・重心・慣性に反映されます。胴体から離すと支持部を追加します。+Xは機首方向です。"
 ],
 "覆盖“{name}”？原设计将被替换。": [
  "Overwrite “{name}”? Its saved design will be replaced.",
  "「{name}」を上書きしますか？保存済みの設計を置き換えます。"
 ],
 "飞机已保存在此浏览器": [
  "Aircraft saved in this browser",
  "このブラウザーに機体を保存しました"
 ],
 "文件超过 100 KB": [
  "File exceeds 100 KB",
  "ファイルが100 KBを超えています"
 ],
 "导入成功": [
  "Import complete",
  "読み込み完了"
 ],
 "已导入机库，但当前挑战只允许无动力鸟人间设计，未加载。": [
  "Saved to the hangar, but not loaded: this challenge only allows unpowered Birdman designs.",
  "格納庫に保存しましたが、読み込みませんでした。このチャレンジでは無動力の鳥人間設計のみ使用できます。"
 ],
 "高山速降机动型": [
  "Alpine agile",
  "山岳機動型"
 ],
 "低空喷气巡航型": [
  "Low-altitude jet cruiser",
  "低空ジェット巡航型"
 ],
 "拖动四个顶点，或拖动 1–4 根弦、2–3 梢弦的外伸圆形手柄，同时移动两端。顶点过近时自动外移，虚线连接真实位置。垂直位置轻微吸附，按住 Ctrl 自由微调。数字输入可精确调整同一组顶点。": [
  "Drag four vertices, or the offset circular handles on root-chord 1–4 and tip-chord 2–3 to move both ends. Closely spaced handles move outward; dashed lines show their true positions. Soft vertical snapping; hold Ctrl for fine adjustment. Number fields edit the same vertices precisely.",
  "4頂点をドラッグするか、根弦1–4・翼端弦2–3の外側の丸ハンドルで両端を動かします。近いハンドルは自動で外へずらし、破線で実位置を示します。縦方向に軽く吸着し、Ctrlで自由に微調整できます。数値欄でも同じ頂点を精密に編集できます。"
 ],
 "精确编辑四个顶点": [
  "Edit four vertices precisely",
  "4頂点を数値で編集"
 ],
 "顶点": [
  "Vertex",
  "頂点"
 ],
 "后向 x / m": [
  "Aft x / m",
  "後方 x / m"
 ],
 "半展": [
  "Half-span",
  "半翼幅"
 ],
 "翼根前缘": [
  "Root leading edge",
  "翼根前縁"
 ],
 "翼梢前缘": [
  "Tip leading edge",
  "翼端前縁"
 ],
 "翼梢后缘": [
  "Tip trailing edge",
  "翼端後縁"
 ],
 "翼根后缘": [
  "Root trailing edge",
  "翼根後縁"
 ],
 "顶点{p0}后向坐标": [
  "Vertex {p0} aft coordinate",
  "頂点{p0}の後方座標"
 ],
 "顶点{p0}展向坐标": [
  "Vertex {p0} span coordinate",
  "頂点{p0}の翼幅座標"
 ],
 "翼面材料": [
  "Surface material",
  "翼面材料"
 ],
 "密度": [
  "Density",
  "密度"
 ],
 "弹性模量 E / G": [
  "Elastic modulus E / G",
  "弾性係数 E / G"
 ],
 "等效压缩 / 剪切强度": [
  "Equivalent compression / shear strength",
  "等価圧縮 / せん断強度"
 ],
 "材料用量按比例改变承力梁面积，截面各长度按用量平方根缩放；增加用量会增加梁质量、刚度与断裂极限。选择材料不重置用量；蒙皮沿用固定面密度，不提供梁尺寸调整。": [
  "Material amount scales spar area proportionally and section lengths by its square root. More material adds spar mass, stiffness and fracture capacity. Changing material keeps the amount; skin areal density stays fixed. Spar dimensions are not adjustable here.",
  "材料量に比例して桁断面積を変え、断面の各長さは材料量の平方根で拡縮します。増量で桁の質量・剛性・破断限界が増えます。材料変更でも量は維持し、外皮の面密度は固定です。桁寸法の調整はできません。"
 ],
 "采用分段等效梁与线弹性近似；超过极限沿气动分段断裂。不是复合材料铺层分析，也不模拟真实颤振。": [
  "Segmented equivalent beams use a linear-elastic approximation and fracture along aerodynamic segments above the limit. Composite layups and real flutter are not modeled.",
  "分割等価梁と線形弾性近似を使い、極限を超えると空力区間に沿って破断します。複合材の積層解析と実際のフラッターは対象外です。"
 ],
 "请输入有限数值，已恢复原值。": [
  "Enter a finite number. The previous value was restored.",
  "有限の数値を入力してください。元の値に戻しました。"
 ],
 "根弦与梢弦至少 0.15 m，已恢复原值。": [
  "Root and tip chords must be at least 0.15 m. The previous value was restored.",
  "根弦と翼端弦は0.15 m以上必要です。元の値に戻しました。"
 ],
 "声音": [
  "Sound",
  "サウンド"
 ],
 "全部静音": [
  "Mute all",
  "すべて消音"
 ],
 "音乐": [
  "Music",
  "音楽"
 ],
 "音效": [
  "Effects",
  "効果音"
 ],
 "首次点击或按键后启用声音。暂停或切到后台时停止播放。": [
  "Sound starts after your first click or key press. Playback stops while paused or in the background.",
  "最初のクリック・キー入力で音を有効にします。一時停止中とバックグラウンドでは再生を止めます。"
 ],
 "音乐署名与许可（新标签页）": [
  "Music credits & license (new tab)",
  "音楽のクレジット・ライセンス（新しいタブ）"
 ],
 "浏览器无法保存声音偏好，本次设置仍有效。": [
  "The browser could not save sound preferences. These settings still apply for this session.",
  "ブラウザーにサウンド設定を保存できませんでした。今回の設定は有効です。"
 ],
 "声音偏好无法读取，使用默认音量。": [
  "Could not read sound preferences. Using default volumes.",
  "サウンド設定を読み込めないため、初期音量を使います。"
 ],
 "机身端点必须是有限数值": [
  "Fuselage endpoints must be finite",
  "胴体端点は有限値で指定してください"
 ],
 "湖风 01": [
  "Lakewind 01",
  "湖風 01"
 ],
 "飞机数据必须是对象": [
  "Aircraft data must be an object",
  "機体データはオブジェクトで指定してください"
 ],
 "参数必须在 {p0} 至 {p1} 之间": [
  "Parameter must be between {p0} and {p1}",
  "パラメーターは{p0}～{p1}の範囲で指定してください"
 ],
 "名称长度须为 1–60 字符": [
  "Name must be 1–60 characters",
  "名前は1～60文字で指定してください"
 ],
 "鸟人间设计开关必须是布尔值": [
  "Birdman design flag must be boolean",
  "鳥人間の設計フラグは真偽値で指定してください"
 ],
 "未知发动机型号": [
  "Unknown engine type",
  "不明なエンジン形式です"
 ],
 "发动机数量须为0、1或2": [
  "Engine count must be 0, 1 or 2",
  "エンジン数は0、1、2のいずれかです"
 ],
 "发动机安装位置须为上方或下方": [
  "Engine mount must be above or below",
  "エンジン取付位置は上方または下方です"
 ],
 "鸟人间设计不能安装动力发动机": [
  "Birdman designs cannot use powered engines",
  "鳥人間の設計に動力エンジンは搭載できません"
 ],
 "翼面必须有四个顶点": [
  "A surface must have four vertices",
  "翼面には4頂点が必要です"
 ],
 "未知翼面材料": [
  "Unknown surface material",
  "不明な翼面材料です"
 ],
 "梁截面必须是闭口矩形管参数": [
  "Spar section must define a closed rectangular tube",
  "桁断面は閉じた角管のパラメーターで指定してください"
 ],
 "梁管壁厚的两倍必须小于宽度和高度": [
  "Twice the spar wall thickness must be less than its width and height",
  "桁の肉厚の2倍は幅と高さより小さくしてください"
 ],
 "鸟人间设计只允许垂尾操纵，主翼和平尾不能安装控制面": [
  "Birdman allows only rudder control; main wing and horizontal tail cannot have control surfaces",
  "鳥人間では垂直尾翼のみ操舵でき、主翼と水平尾翼に舵面は付けられません"
 ],
 "翼面不得自交，根弦与梢弦至少 0.15 m": [
  "Surfaces must not self-intersect; root and tip chords must be at least 0.15 m",
  "翼面は自己交差不可で、根弦と翼端弦は0.15 m以上必要です"
 ],
 "机身必须支撑驾驶舱，机头须在驾驶舱前至少 0.95 m": [
  "The fuselage must support the cockpit, with the nose at least 0.95 m ahead",
  "胴体はコックピットを支持し、機首はその0.95 m以上前に配置してください"
 ],
 "机身必须支撑水平尾翼与垂直尾翼安装点": [
  "The fuselage must support both tail mounts",
  "胴体は水平・垂直尾翼の取付点を支持する必要があります"
 ],
 "机身必须支撑发动机安装点": [
  "The fuselage must support the engine mount",
  "胴体はエンジン取付点を支持する必要があります"
 ],
 "主翼翼根无法安装到当前机身，请调整机身或翼根": [
  "The main-wing root does not fit this fuselage. Adjust the fuselage or wing root.",
  "主翼の翼根を現在の胴体に取り付けられません。胴体か翼根を調整してください。"
 ],
 "默认均衡型": [
  "Balanced default",
  "標準バランス型"
 ],
 "高展弦比型": [
  "High aspect ratio",
  "高アスペクト比型"
 ],
 "高稳定型": [
  "High stability",
  "高安定型"
 ],
 "灵敏操纵型": [
  "Agile controls",
  "敏感操縦型"
 ],
 "重心过后不稳定型": [
  "Unstable aft CG",
  "後方重心・不安定型"
 ],
 "高翼载荷型": [
  "High wing loading",
  "高翼面荷重型"
 ],
 "云杉": [
  "Spruce",
  "スプルース"
 ],
 "等效弹性限 / 等效拉伸极限": [
  "Equivalent elastic / tensile limit",
  "等価弾性限 / 等価引張限界"
 ],
 "密度与顺纹 E 为参考值；G 0.69 GPa、弹性限 40 MPa、拉伸极限 70 MPa、压缩 35 MPa、剪切 6 MPa 均为工程等效值，非方向实测。": [
  "Density and along-grain E are reference values. G 0.69 GPa, elastic limit 40 MPa, tensile limit 70 MPa, compression 35 MPa and shear 6 MPa are engineering equivalents, not direction-specific measurements.",
  "密度と繊維方向のEは参考値です。G 0.69 GPa、弾性限40 MPa、引張限界70 MPa、圧縮35 MPa、せん断6 MPaは工学的な等価値で、方向別の実測値ではありません。"
 ],
 "6061-T6 铝": [
  "6061-T6 aluminum",
  "6061-T6 アルミ"
 ],
 "屈服 / 拉伸极限": [
  "Yield / tensile limit",
  "降伏 / 引張限界"
 ],
 "屈服 276 MPa、拉伸极限 310 MPa；G 26 GPa、压缩 276 MPa、剪切 179 MPa 为保守工程等效值，非方向实测。": [
  "Yield 276 MPa, tensile limit 310 MPa. G 26 GPa, compression 276 MPa and shear 179 MPa are conservative engineering equivalents, not direction-specific measurements.",
  "降伏276 MPa、引張限界310 MPa。G 26 GPa、圧縮276 MPa、せん断179 MPaは保守的な工学等価値で、方向別の実測値ではありません。"
 ],
 "成品碳/环氧层板": [
  "Finished carbon/epoxy laminate",
  "成形済みカーボン・エポキシ積層板"
 ],
 "等效弹性限 / 拉伸极限": [
  "Equivalent elastic / tensile limit",
  "等価弾性限 / 引張限界"
 ],
 "成品层板密度 1500 kg/m³、E 70 GPa、拉伸极限 600 MPa；G 5 GPa、弹性限 350 MPa、压缩 300 MPa、剪切 60 MPa 为保守工程等效值，非金属屈服或方向实测。": [
  "Finished laminate: density 1500 kg/m³, E 70 GPa, tensile limit 600 MPa. G 5 GPa, elastic limit 350 MPa, compression 300 MPa and shear 60 MPa are conservative engineering equivalents, not metal yield or direction-specific measurements.",
  "成形済み積層板の密度1500 kg/m³、E 70 GPa、引張限界600 MPa。G 5 GPa、弾性限350 MPa、圧縮300 MPa、せん断60 MPaは保守的な工学等価値で、金属の降伏や方向別の実測値ではありません。"
 ],
 "鸟人间": [
  "Birdman",
  "鳥人間"
 ],
 "低空挑战": [
  "Low-altitude challenge",
  "低空チャレンジ"
 ],
 "本地存储空间已满，请导出飞机备份后清理空间。": [
  "Local storage is full. Export aircraft backups, then free some space.",
  "ローカルストレージが満杯です。機体を書き出してバックアップし、空き容量を確保してください。"
 ],
 "无法访问浏览器本地存储，请允许本站保存数据后重试。": [
  "Cannot access browser storage. Allow this site to save data, then retry.",
  "ブラウザーのストレージにアクセスできません。このサイトのデータ保存を許可して再試行してください。"
 ],
 "飞机数据无效：{p0}": [
  "Invalid aircraft data: {p0}",
  "無効な機体データ：{p0}"
 ],
 "请检查参数和翼面几何。": [
  "Check parameters and surface geometry.",
  "パラメーターと翼面形状を確認してください。"
 ],
 "飞机数据无法转换为 JSON，请检查导入数据。": [
  "Cannot convert aircraft data to JSON. Check the imported data.",
  "機体データをJSONに変換できません。読み込むデータを確認してください。"
 ],
 "保存记录无效": [
  "Invalid saved record",
  "保存記録が無効です"
 ],
 "保存名称不一致": [
  "Saved names do not match",
  "保存された名前が一致しません"
 ],
 "未找到这架飞机，可能已被删除。": [
  "Aircraft not found. It may have been deleted.",
  "機体が見つかりません。削除された可能性があります。"
 ],
 "这架飞机的本地记录已损坏；原始数据仍然保留。": [
  "This aircraft record is damaged. Its original data has been kept.",
  "この機体の保存記録が壊れています。元のデータは保持しています。"
 ],
 "{p0} 副本": [
  "{p0} copy",
  "{p0} コピー"
 ],
 "无法读取 JSON，请选择有效的飞机 JSON 文件。": [
  "Cannot read JSON. Choose a valid aircraft JSON file.",
  "JSONを読み込めません。有効な機体JSONファイルを選択してください。"
 ],
 "本地最远纪录已损坏；原始数据仍然保留。": [
  "The local best record is damaged. Its original data has been kept.",
  "ローカルの最高記録が壊れています。元のデータは保持しています。"
 ],
 "距离和时间须为非负有限数值，得分须为有限数值。": [
  "Distance and time must be finite and nonnegative; score must be finite.",
  "距離と時間は非負の有限値、得点は有限値で指定してください。"
 ],
 "浏览器无法启用音频；游戏仍可继续。": [
  "The browser could not enable audio. You can keep playing.",
  "ブラウザーで音声を有効にできませんでした。ゲームは続けられます。"
 ],
 "钢琴音乐暂时无法播放；游戏仍可继续，可点击页面重试。": [
  "Piano music cannot play right now. You can keep playing; click the page to retry.",
  "ピアノ音楽を再生できません。ゲームは続けられます。ページをクリックして再試行してください。"
 ],
 "音频暂停失败；游戏仍可继续。": [
  "Audio could not pause. You can keep playing.",
  "音声を一時停止できませんでした。ゲームは続けられます。"
 ],
 "音频未能启动，请点击页面重试。": [
  "Audio could not start. Click the page to retry.",
  "音声を開始できませんでした。ページをクリックして再試行してください。"
 ],
 "滑空机三维视图。拖动旋转，滚轮缩放，右键或双指平移。": [
  "3D glider view. Drag to orbit, scroll to zoom, right-drag or use two fingers to pan.",
  "滑空機の3Dビュー。ドラッグで回転、ホイールで拡縮、右ドラッグまたは2本指で平行移動します。"
 ],
 "真实翼面与部件位置编辑": [
  "Edit actual surface and component positions",
  "実際の翼面・部品位置を編集"
 ],
 "满油圆点": [
  "Full-fuel circle",
  "満タンの丸"
 ],
 "空油菱形": [
  "Empty-fuel diamond",
  "空タンクのひし形"
 ],
 "根弦 1–4": [
  "Root 1–4",
  "根弦 1–4"
 ],
 "梢弦 2–3": [
  "Tip 2–3",
  "翼端弦 2–3"
 ],
 "主翼位置": [
  "Main-wing position",
  "主翼位置"
 ],
 "引擎位置": [
  "Engine position",
  "エンジン位置"
 ],
 "油箱位置": [
  "Tank position",
  "タンク位置"
 ],
 "{wing}{side}顶点{index}": [
  "{wing} {side} vertex {index}",
  "{wing}{side}の頂点{index}"
 ],
 "左翼": [
  "Left wing",
  "左翼"
 ],
 "主翼安装": [
  "Main-wing mount",
  "主翼取付"
 ],
 "平尾安装": [
  "Horizontal-tail mount",
  "水平尾翼取付"
 ],
 "垂尾安装": [
  "Vertical-tail mount",
  "垂直尾翼取付"
 ],
 "右翼": [
  "Right wing",
  "右翼"
 ],
 "根弦线段1–4": [
  "Root-chord segment 1–4",
  "根弦線分1–4"
 ],
 "{side}梢弦线段2–3": [
  "{side} tip-chord segment 2–3",
  "{side}の翼端弦線分2–3"
 ],
 "自由镜头": [
  "Free camera",
  "自由カメラ"
 ],
 "三维": [
  "3D",
  "3D"
 ],
 "计时起点 START": [
  "Timing start",
  "計時スタート"
 ],
 "终点 FINISH": [
  "Finish",
  "ゴール"
 ],
 "检查点 {index} · {distance} m": [
  "Checkpoint {index} · {distance} m",
  "チェックポイント {index} · {distance} m"
 ],
 "20 m 高山弹射台 · 离地至少 50 m · 过蓝门计时": [
  "20 m summit catapult · at least 50 m ground clearance · timing starts at blue gate",
  "20 mの山頂射出台 · 対地高度50 m以上 · 青ゲートで計時開始"
 ],
 "跑道上方 2 m 导轨 · 升力脱轨 · 过蓝门计时": [
  "Rail 2 m above runway · lift-off release · timing starts at blue gate",
  "滑走路上2 mのレール · 揚力で離脱 · 青ゲートで計時開始"
 ],
 "跑道 10 m · 坡度 3.5°": [
  "10 m ramp · 3.5° slope",
  "助走路10 m · 勾配3.5°"
 ],
 "离台能量守恒": [
  "Energy balance after release",
  "離陸後のエネルギー保存"
 ],
 "J。": [
  "J.",
  "J。"
 ],
 "距离高度曲线": [
  "Distance–altitude chart",
  "距離・高度グラフ"
 ],
 "剩余机械能占比曲线": [
  "Remaining mechanical energy ratio chart",
  "残存力学的エネルギー比率グラフ"
 ],
 "实时能耗曲线": [
  "Instant energy cost chart",
  "瞬時エネルギー消費グラフ"
 ],
 "计分高度参考曲线": [
  "Scoring-height reference curve",
  "得点高度の参照線"
 ],
 "空速曲线": [
  "Airspeed chart",
  "対気速度グラフ"
 ],
 "三维滑空机与湖面场景": [
  "3D glider and lake scene",
  "滑空機と湖面の3Dシーン"
 ],
 "返回主菜单": [
  "Main menu",
  "メインメニューへ"
 ],
 "GitHub 项目源码（新标签页）": [
  "GitHub source code (new tab)",
  "GitHubソースコード（新しいタブ）"
 ],
 "GitHub 项目源码": [
  "GitHub source code",
  "GitHubソースコード"
 ],
 "游戏流程": [
  "Game navigation",
  "ゲームの操作"
 ],
 "飞机名称": [
  "Aircraft name",
  "機体名"
 ],
 "部件编辑": [
  "Component editor",
  "部品編集"
 ],
 "机身端点精确值": [
  "Precise fuselage endpoints",
  "胴体端点の精密値"
 ],
 "机头端点精确值": [
  "Precise nose endpoint",
  "機首端点の精密値"
 ],
 "机尾端点精确值": [
  "Precise tail endpoint",
  "尾部端点の精密値"
 ],
 "固定驾驶员质量": [
  "Fixed pilot mass",
  "固定の操縦者質量"
 ],
 "驾驶舱位置精确值": [
  "Precise cockpit position",
  "コックピット位置の精密値"
 ],
 "重心前后行程": [
  "Fore/aft CG travel",
  "重心の前後移動量"
 ],
 "重心左右行程": [
  "Lateral CG travel",
  "重心の左右移動量"
 ],
 "引擎数量": [
  "Engine count",
  "エンジン数"
 ],
 "引擎纵向位置": [
  "Engine longitudinal position",
  "エンジンの前後位置"
 ],
 "引擎垂直偏移": [
  "Engine vertical offset",
  "エンジンの上下位置"
 ],
 "油箱容量": [
  "Tank capacity",
  "タンク容量"
 ],
 "油箱固定在机身内部，起飞装满；燃油消耗改变质量与重心，耗尽后引擎无推力。": [
  "The tank stays inside the fuselage and starts full. Fuel burn changes mass and CG; engines produce no thrust when empty.",
  "タンクは胴体内部に固定し、離陸時は満タンです。燃料消費で質量・重心が変わり、空になると推力がなくなります。"
 ],
 "油箱纵向位置": [
  "Tank longitudinal position",
  "タンクの前後位置"
 ],
 "位置范围随容量和机身空间调整，油箱整体始终位于机身内部。": [
  "Position limits follow tank capacity and available fuselage space; the whole tank stays inside the fuselage.",
  "位置範囲は容量と胴体の空間に応じて変わり、タンク全体を胴体内に収めます。"
 ],
 "组装位置精确值": [
  "Precise assembly positions",
  "組立位置の精密値"
 ],
 "{p0}精确值": [
  "{p0} precise value",
  "{p0}の精密値"
 ],
 "主翼安装高度": [
  "Main-wing mount height",
  "主翼取付高度"
 ],
 "0 m 直接安装机身；正值在上、负值在下。离开机身自动生成根弦宽支撑，面积越大越重；拖动时 Ctrl 可绕过吸附。": [
  "0 m mounts directly to the fuselage; positive is above, negative below. Away from the fuselage, a root-chord-wide support is added; larger area adds mass. Hold Ctrl while dragging to bypass snapping.",
  "0 mで胴体に直接取り付け、正は上、負は下です。離すと根弦幅の支持部を自動生成し、面積が大きいほど重くなります。ドラッグ時はCtrlで吸着を解除できます。"
 ],
 "主翼安装角": [
  "Main-wing incidence",
  "主翼取付角"
 ],
 "提高安装角会增加有效攻角；过大可能失速。": [
  "More incidence increases effective angle of attack; too much can cause a stall.",
  "取付角を増やすと有効迎角が増え、過大だと失速する場合があります。"
 ],
 "水平尾翼安装角": [
  "Horizontal-tail incidence",
  "水平尾翼取付角"
 ],
 "调节尾翼安装角以配平，观察离台后攻角与俯仰变化。": [
  "Adjust tail incidence for trim; watch angle of attack and pitch after release.",
  "尾翼取付角でトリムを調整し、離陸後の迎角とピッチを確認します。"
 ],
 "主翼上反角": [
  "Main-wing dihedral",
  "主翼上反角"
 ],
 "增加侧滑时的滚转恢复效应，不会强制飞机自动水平。": [
  "Increases roll restoration in sideslip; it does not force the aircraft level.",
  "横滑り時のロール復元効果を増やします。機体を強制的に水平にはしません。"
 ],
 "预设飞机": [
  "Aircraft preset",
  "プリセット機体"
 ],
 "设计相机": [
  "Design camera",
  "設計カメラ"
 ],
 "设计实时仪表": [
  "Live design instruments",
  "設計のリアルタイム計器"
 ],
 "飞机性能估算": [
  "Aircraft performance estimates",
  "機体性能の推定"
 ],
 "全备质量": [
  "All-up mass",
  "全備質量"
 ],
 "主翼支撑面积": [
  "Main-wing support area",
  "主翼支持部面積"
 ],
 "主翼支撑质量": [
  "Main-wing support mass",
  "主翼支持部質量"
 ],
 "自由空气、无地效的设计估算；飞行时随离水高度变化": [
  "Design estimate in free air without ground effect; changes with height over water during flight",
  "自由空気・地面効果なしでの設計推定。飛行中は水面からの高さで変わります"
 ],
 "全重、主翼面积、海平面、无地效": [
  "All-up weight, main-wing area, sea level, no ground effect",
  "全備重量・主翼面積・海面高度・地面効果なし"
 ],
 "重心与升力中心配平参考": [
  "CG and force-center trim reference",
  "重心と揚力中心のトリム参考"
 ],
 "重心X": [
  "CG X",
  "重心X"
 ],
 "全机升力中心X": [
  "Aircraft lift center X",
  "全機揚力中心X"
 ],
 "全机阻力中心X": [
  "Aircraft drag center X",
  "全機抗力中心X"
 ],
 "燃油重心范围": [
  "Fuel CG range",
  "燃料による重心範囲"
 ],
 "满油重心X": [
  "Full-fuel CG X",
  "満タン重心X"
 ],
 "空油重心X": [
  "Empty-fuel CG X",
  "空タンク重心X"
 ],
 "{p0}气动作用": [
  "{p0} aerodynamic action",
  "{p0}の空力作用"
 ],
 "{p0}有效攻角": [
  "{p0} effective angle of attack",
  "{p0}の有効迎角"
 ],
 "{p0}{p1}": [
  "{p0} {p1}",
  "{p0}{p1}"
 ],
 "{p0}阻力": [
  "{p0} drag",
  "{p0}の抗力"
 ],
 "飞行数据": [
  "Flight data",
  "飛行データ"
 ],
 "真实耗散功率除以世界水平速度；助跑或水平速度不超过0.05 m/s时无定义": [
  "Actual dissipation power divided by world horizontal speed; undefined during launch or at horizontal speeds of 0.05 m/s or below",
  "実散逸出力をワールド水平速度で割った値。助走中または水平速度0.05 m/s以下では未定義"
 ],
 "贴地挑战数据": [
  "Low-altitude challenge data",
  "低空チャレンジのデータ"
 ],
 "引擎数据": [
  "Engine data",
  "エンジンデータ"
 ],
 "油门": [
  "Throttle",
  "スロットル"
 ],
 "空格开始 / 暂停 / 继续": [
  "Space to start / pause / resume",
  "スペースで開始 / 停止 / 再開"
 ],
 "飞行相机": [
  "Flight camera",
  "飛行カメラ"
 ],
 "锁定": [
  "Locked",
  "固定"
 ],
 "C 键切换视角 · 锁定视角不可拖动 · 自由视角拖动环绕、滚轮缩放，不自动回中": [
  "C to change view · Locked view cannot be dragged · Free view: drag to orbit, scroll to zoom, no automatic recentering",
  "Cで視点切替 · 固定視点はドラッグ不可 · 自由視点：ドラッグで旋回、ホイールでズーム、自動復帰なし"
 ],
 "重心操纵输入": [
  "Pitch / weight-shift input",
  "ピッチ・重心移動入力"
 ],
 "左滚转": [
  "Roll left",
  "左ロール"
 ],
 "右滚转": [
  "Roll right",
  "右ロール"
 ],
 "滚转操纵输入": [
  "Roll input",
  "ロール入力"
 ],
 "向左转向": [
  "Yaw left",
  "左旋回"
 ],
 "向右转向": [
  "Yaw right",
  "右旋回"
 ],
 "方向操纵输入": [
  "Yaw input",
  "ヨー入力"
 ],
 "结构载荷与断裂状态": [
  "Structural load and fracture status",
  "構造荷重と破断状態"
 ],
 "最大结构形变": [
  "Maximum structural deflection",
  "最大構造変形"
 ],
 "独立断片数量": [
  "Separate fragment count",
  "独立破片数"
 ],
 "飞行结算": [
  "Flight results",
  "飛行結果"
 ],
 "最终结构状态": [
  "Final structural status",
  "最終構造状態"
 ],
 "本地机库": [
  "Local hangar",
  "ローカル格納庫"
 ],
 "导入飞机文件": [
  "Import aircraft file",
  "機体ファイルを読み込む"
 ],
 "重命名{p0}": [
  "Rename {p0}",
  "{p0}の名前変更"
 ],
 "开发性能面板": [
  "Developer performance panel",
  "開発用性能パネル"
 ],
 "关闭提示": [
  "Dismiss notification",
  "通知を閉じる"
 ],
 "材料用量": [
  "Material amount",
  "材料量"
 ],
 "声音设置": [
  "Sound settings",
  "サウンド設定"
 ],
 "声音选项": [
  "Sound options",
  "サウンドオプション"
 ],
 "音乐音量": [
  "Music volume",
  "音楽の音量"
 ],
 "音效音量": [
  "Effects volume",
  "効果音の音量"
 ],
 "更多": [
  "More",
  "その他"
 ],
 "{wing}{chord}": [
  "{wing} {chord}",
  "{wing}{chord}"
 ],
 "已加载 {name}": [
  "Loaded {name}",
  "{name}を読み込みました"
 ],
 "导入失败：{error}": [
  "Import failed: {error}",
  "読み込み失敗：{error}"
 ],
 "未知飞行挑战": [
  "Unknown flight challenge",
  "不明な飛行チャレンジです"
 ],
 "鸟人间比赛只允许无动力鸟人间设计": [
  "Birdman requires an unpowered Birdman design",
  "鳥人間競技には無動力の鳥人間設計が必要です"
 ],
 "离台滚转角须在 ±1° 之间": [
  "Launch roll must be within ±1°",
  "離陸時のロール角は±1°以内で指定してください"
 ],
 "飞行记录长度无效": [
  "Invalid flight recording length",
  "飛行記録の長さが無効です"
 ],
 "飞行记录离台滚转角无效": [
  "Invalid launch roll in flight recording",
  "飛行記録の離陸時ロール角が無効です"
 ],
 "飞行记录包含无效输入": [
  "Flight recording contains invalid input",
  "飛行記録に無効な入力が含まれています"
 ],
 "步长须在 0 至 0.25 秒之间": [
  "Time step must be greater than 0 and at most 0.25 s",
  "時間刻みは0秒より大きく0.25秒以下で指定してください"
 ],
 "操纵输入必须为有限数": [
  "Control input must be finite",
  "操縦入力は有限値で指定してください"
 ],
 "气动力中点求解未收敛": [
  "Aerodynamic midpoint solver did not converge",
  "空力の中点計算が収束しませんでした"
 ],
 "断片气动力中点求解未收敛": [
  "Fragment aerodynamic midpoint solver did not converge",
  "破片の空力中点計算が収束しませんでした"
 ],
 "绘制调用": ["draw calls", "描画呼び出し"],
 "三角形": ["triangles", "三角形"],
 "自动": ["Auto", "自動"],
 "高": ["High", "高"],
 "中": ["Medium", "中"],
 "低": ["Low", "低"],
 "预设设计": ["Design presets", "設計プリセット"],
 "本次滑翔成绩": ["Glide result", "今回の滑空結果"]
};
