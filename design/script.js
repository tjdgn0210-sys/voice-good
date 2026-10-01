// 목업 데이터: src/domain/transaction/transaction.ts 의 Transaction 형태와 같다.
// - amount: 양의 정수 (지출도 음수로 쓰지 않음)
// - occurredAt/createdAt/updatedAt: UTC ISO 문자열 (끝이 Z)
// - inputMethod: 'MANUAL' | 'VOICE' | 'TEXT'

// 오늘 기준 날짜를 만들어 UTC ISO 문자열로 바꾼다. (언제 열어도 "오늘" 합계가 보이도록)
function localTimeIso(daysAgo, hour, minute) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function makeTransaction(id, amount, category, memo, daysAgo, hour, minute, inputMethod, rawInput) {
  const occurredAt = localTimeIso(daysAgo, hour, minute);
  return {
    id,
    type: 'EXPENSE',
    amount,
    currencyCode: 'KRW',
    category,
    memo,
    occurredAt,
    inputMethod,
    rawInput,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
  };
}

const mockTransactions = [
  makeTransaction('7d3f1c2a-0001-4a6b-9c1e-000000000001', 8000, '식비', '점심', 0, 12, 30, 'VOICE', '점심 8천원 썼어'),
  makeTransaction('7d3f1c2a-0002-4a6b-9c1e-000000000002', 4500, '카페', '아메리카노', 0, 9, 10, 'TEXT', '아메리카노 4500원'),
  makeTransaction('7d3f1c2a-0003-4a6b-9c1e-000000000003', 1450, '교통', null, 0, 8, 20, 'MANUAL', null),
  makeTransaction('7d3f1c2a-0004-4a6b-9c1e-000000000004', 32000, null, '친구 생일 선물, 포장비 포함. 메모가 길면 두 줄까지만 보이고 나머지는 말줄임표로 잘리는지 확인하기 위한 문장입니다.', 1, 19, 45, 'MANUAL', null),
  makeTransaction('7d3f1c2a-0005-4a6b-9c1e-000000000005', 12900, '생활', '세제', 2, 15, 0, 'TEXT', '세제 12900원 샀어'),
];
// 시나리오가 기록을 추가하므로 처음 모습을 기억해 둔다
const baseTransactions = [...mockTransactions];

// ---------- 캘린더 목업: Event(src/domain/event/event.ts) · Task(src/domain/task/task.ts) 와 같은 필드 ----------
// - Event: 시간이 정확하면 kind 'EXACT' + startAt(UTC ISO). 시간이 모호한 말("저녁쯤")은 날짜를 알 수 없어 캘린더에 올리지 않는다.
// - 지난 약속은 자동으로 COMPLETED 가 되지 않고 PAST 가 된다.
// - Task: dueAt(UTC ISO), 상태 OPEN → 체크하면 COMPLETED + completedAt. 날짜만 말한 마감은 그날 23:59 로 둔다.
// - 삭제는 deletedAt 을 채우는 소프트 삭제.
const TIMEZONE = 'Asia/Seoul';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const clone = item => ({ ...item });
const pad2 = number => String(number).padStart(2, '0');
let idCounter = 0;
const newId = group => `7d3f1c2a-${group}-4a6b-9c1e-${String(Date.now()).slice(-8)}${String(++idCounter).padStart(4, '0')}`;

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

// 한 달 뒤/앞으로: 31일 → 30일뿐인 달이면 말일로 맞춘다
function addMonths(date, count) {
  const result = new Date(date.getFullYear(), date.getMonth() + count, 1);
  const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), last));
  return result;
}

const startOfWeek = date => addDays(startOfDay(date), -date.getDay()); // 일요일 시작
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayStart = offset => addDays(startOfDay(new Date()), offset);

function atTime(date, hour, minute) {
  const result = startOfDay(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

const dateKey = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// "2026-10-02" 처럼 적은 날짜를 읽는다. 없는 날짜(2026-02-31)는 null.
function parseDateKey(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const valid = date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  return valid ? date : null;
}

// "15:00" 처럼 24시간으로 적은 시간을 읽는다
function parseClock(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function makeEventAt(id, title, start, durationMinutes, location) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    kind: 'EXACT',
    startAt: start.toISOString(),
    fuzzyTime: null,
    endAt: new Date(start.getTime() + durationMinutes * 60000).toISOString(),
    timezone: TIMEZONE,
    location: location ?? null,
    status: start.getTime() < Date.now() ? 'PAST' : 'UPCOMING',
    sourceActionId: `action-${id}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function makeTaskAt(id, title, due) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    dueAt: due.toISOString(),
    status: 'OPEN',
    completedAt: null,
    sourceActionId: `action-${id}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

const mockEvents = [
  makeEventAt('7d3f1c2a-1001-4a6b-9c1e-000000000001', '팀 미팅', atTime(dayStart(0), 14, 0), 60, '3층 회의실'),
  makeEventAt('7d3f1c2a-1002-4a6b-9c1e-000000000002', '병원 예약', atTime(dayStart(2), 10, 30), 30, '내과'),
  makeEventAt('7d3f1c2a-1003-4a6b-9c1e-000000000003', '가족 저녁', atTime(dayStart(4), 19, 0), 120, null),
];
const mockTasks = [
  makeTaskAt('7d3f1c2a-1101-4a6b-9c1e-000000000001', '택배 보내기', atTime(dayStart(0), 18, 0)),
  makeTaskAt('7d3f1c2a-1102-4a6b-9c1e-000000000002', '공과금 내기', atTime(dayStart(1), 23, 59)),
];
const baseEvents = mockEvents.map(clone);
const baseTasks = mockTasks.map(clone);

// 캘린더 화면 상태: 어떤 방식(일/주/월)으로, 어느 날을 보고 있는지
const VIEWS = ['day', 'week', 'month'];
let calView = 'week';
let focusDate = dayStart(0);

// 시나리오·"처음으로"가 호출한다: 지출·약속·할 일을 처음 모습으로 되돌리고 오늘을 보여 준다 (보기 방식은 그대로)
function restoreTransactions() {
  mockTransactions.splice(0, mockTransactions.length, ...baseTransactions);
  mockEvents.splice(0, mockEvents.length, ...baseEvents.map(clone));
  mockTasks.splice(0, mockTasks.length, ...baseTasks.map(clone));
  focusDate = dayStart(0);
}

// 앱의 expenses.summary(오늘 0시 ~ 내일 0시)와 같은 계산
function todaySummary(items) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const today = items.filter(item => {
    const time = Date.parse(item.occurredAt);
    return item.type === 'EXPENSE' && item.currencyCode === 'KRW' && time >= start.getTime() && time < end.getTime();
  });
  return { total: today.reduce((sum, item) => sum + item.amount, 0), count: today.length };
}

// ---------- 표시 형식: home-screen.tsx 와 같은 규칙 ----------
function formatAmount(item) {
  return item.amount.toLocaleString('ko-KR') + (item.currencyCode === 'KRW' ? '원' : ` ${item.currencyCode}`);
}

function formatInputMethod(inputMethod) {
  return inputMethod === 'VOICE' ? '음성' : inputMethod === 'TEXT' ? '문장' : '직접 입력';
}

function formatMeta(item) {
  return `${new Date(item.occurredAt).toLocaleString('ko-KR')} · ${formatInputMethod(item.inputMethod)}`;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

// FlatList renderItem 한 줄: 위 줄에 분류(왼쪽)와 금액(오른쪽), 아래에 메모와 날짜
// parts 는 시나리오에서 캐릭터가 글자를 하나씩 적을 때 쓴다.
function buildRecord(item) {
  const record = document.createElement('button');
  record.className = 'record';
  record.setAttribute('aria-label', `${item.category ?? '미분류'} ${item.amount.toLocaleString('ko-KR')}원, 상세 보기`);

  const title = textElement('p', 'recordTitle', item.category ?? '미분류');
  const amount = textElement('p', 'recordAmount', formatAmount(item));
  const memo = textElement('p', 'text twoLines', item.memo ?? '메모 없음');
  const meta = textElement('p', 'muted', formatMeta(item));

  const top = document.createElement('div');
  top.className = 'rowBetween';
  top.append(title, amount);
  record.append(top, memo, meta);
  return { record, parts: [title, amount, memo, meta] };
}

function renderRecord(item) {
  return buildRecord(item).record;
}

// ---------- 공통 도우미 ----------
function byId(id) {
  return document.getElementById(id);
}

function show(id, visible) {
  byId(id).hidden = !visible;
}

function setDisabled(id, disabled) {
  byId(id).classList.toggle('disabled', disabled);
}

// 눌린 상태 표시: 버튼과 그 안의 글자에 각각 클래스를 붙인다 (앱에서는 두 스타일을 배열로 합친다)
function setActive(button, active, buttonClass, textClass) {
  button.classList.toggle(buttonClass, active);
  button.firstElementChild.classList.toggle(textClass, active);
  button.setAttribute('aria-pressed', String(active));
}

// 디자인 확인용 버튼 강조
function highlight(selector, isActive) {
  document.querySelectorAll(selector).forEach(button => {
    const active = isActive(button);
    button.classList.toggle('designButtonActive', active);
    button.firstElementChild.classList.toggle('designButtonTextActive', active);
  });
}

// ---------- 캘린더 ----------
// 한 줄(약속/할 일)의 화면 요소를 id 로 찾을 수 있게 모아 둔다 (캐릭터가 체크하러 갈 때 쓴다)
const agendaRows = new Map();

// 한 날의 약속·할 일을 시간 순으로 (삭제된 것은 제외)
function itemsForDate(date) {
  const from = startOfDay(date).getTime();
  const to = addDays(startOfDay(date), 1).getTime();
  const within = iso => iso !== null && Date.parse(iso) >= from && Date.parse(iso) < to;
  const events = mockEvents.filter(item => item.deletedAt === null && item.kind === 'EXACT' && within(item.startAt))
    .map(item => ({ type: 'EVENT', date: startOfDay(date), at: Date.parse(item.startAt), item }));
  const tasks = mockTasks.filter(item => item.deletedAt === null && within(item.dueAt))
    .map(item => ({ type: 'TASK', date: startOfDay(date), at: Date.parse(item.dueAt), item }));
  return [...events, ...tasks].sort((a, b) => a.at - b.at);
}

const hasItems = date => itemsForDate(date).length > 0;

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

// 약속은 시각, 할 일은 "마감" (23:59 는 날짜만 정한 마감이라 시각을 숨긴다)
function agendaLabel(entry) {
  if (entry.type === 'EVENT') return formatClock(entry.item.startAt);
  const due = new Date(entry.item.dueAt);
  return due.getHours() === 23 && due.getMinutes() === 59 ? '마감' : `마감 ${formatClock(entry.item.dueAt)}`;
}

const dayLabel = date => `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;

function calendarTitle() {
  if (calView === 'day') return dayLabel(focusDate);
  if (calView === 'month') return `${focusDate.getFullYear()}년 ${focusDate.getMonth() + 1}월`;
  const first = startOfWeek(focusDate);
  const last = addDays(first, 6);
  return first.getMonth() === last.getMonth()
    ? `${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getDate()}일`
    : `${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getMonth() + 1}월 ${last.getDate()}일`;
}

// 한 줄: 왼쪽에 시각(포인트 색)과 제목(누르면 수정), 할 일이면 오른쪽에 체크 칸(누르면 완료). parts 는 캐릭터가 적을 때 쓴다.
function buildAgendaItem(entry) {
  const done = entry.type === 'TASK' && entry.item.status === 'COMPLETED';
  const record = document.createElement('div');
  record.className = 'agendaItem';
  const label = textElement('p', 'agendaTime', agendaLabel(entry));
  const title = textElement('p', done ? 'agendaTitle agendaTitleDone' : 'agendaTitle', entry.item.title);
  const text = document.createElement('div');
  text.className = 'agendaText';
  text.append(label, title);
  const main = document.createElement('button');
  main.className = 'agendaMain';
  main.setAttribute('aria-label', `${agendaLabel(entry)} ${entry.item.title}, 수정`);
  main.append(text);
  main.addEventListener('click', () => openEdit(entry));
  record.append(main);
  if (entry.type === 'TASK') {
    const toggle = document.createElement('button');
    toggle.className = 'taskToggle';
    toggle.setAttribute('role', 'checkbox');
    toggle.setAttribute('aria-checked', String(done));
    toggle.setAttribute('aria-label', `${entry.item.title} ${done ? '완료 취소' : '완료'}`);
    const box = document.createElement('div');
    box.className = done ? 'taskBox taskBoxDone' : 'taskBox';
    if (done) box.append(textElement('p', 'taskCheck', '✓'));
    toggle.append(box);
    toggle.addEventListener('click', () => toggleTask(entry.item.id));
    record.append(toggle);
  }
  agendaRows.set(entry.item.id, record);
  return { record, parts: [label, title] };
}

// 할 일 체크: 완료 ↔ 되돌리기 (Task.status OPEN ↔ COMPLETED, completedAt)
function setTaskDone(id, done) {
  const task = mockTasks.find(item => item.id === id);
  if (!task) return;
  const now = new Date().toISOString();
  task.status = done ? 'COMPLETED' : 'OPEN';
  task.completedAt = done ? now : null;
  task.updatedAt = now;
  renderCalendar();
}

function toggleTask(id) {
  const task = mockTasks.find(item => item.id === id);
  if (task) setTaskDone(id, task.status !== 'COMPLETED');
}

function pickDate(date) {
  focusDate = startOfDay(date);
  renderCalendar();
}

function dotClass(date, active) {
  return hasItems(date) ? (active ? 'dayDot dayDotOnActive' : 'dayDot dayDotOn') : 'dayDot';
}

// 주 보기의 한 칸: 요일 + 날짜 + 일정 점
function buildWeekCell(date) {
  const active = sameDay(date, focusDate);
  const today = sameDay(date, dayStart(0));
  const cell = document.createElement('button');
  cell.className = active ? 'dayCell dayCellActive' : 'dayCell';
  cell.setAttribute('aria-label', dayLabel(date));
  cell.setAttribute('aria-pressed', String(active));
  const dot = document.createElement('div');
  dot.className = dotClass(date, active);
  cell.append(
    textElement('p', active ? 'dayName dayNameActive' : 'dayName', WEEKDAYS[date.getDay()]),
    textElement('p', active ? 'dayNum dayNumActive' : today ? 'dayNum dayNumToday' : 'dayNum', String(date.getDate())),
    dot,
  );
  cell.addEventListener('click', () => pickDate(date));
  return cell;
}

// 월 보기의 한 칸: 날짜 + 일정 점. 이번 달이 아닌 날은 옅게.
function buildMonthCell(date) {
  const active = sameDay(date, focusDate);
  const today = sameDay(date, dayStart(0));
  const inMonth = date.getMonth() === focusDate.getMonth();
  const cell = document.createElement('button');
  cell.className = active ? 'monthCell monthCellActive' : 'monthCell';
  cell.setAttribute('aria-label', dayLabel(date));
  cell.setAttribute('aria-pressed', String(active));
  const numClass = active ? 'monthNum monthNumActive' : today ? 'monthNum monthNumToday' : inMonth ? 'monthNum' : 'monthNum monthNumOut';
  const dot = document.createElement('div');
  dot.className = dotClass(date, active);
  cell.append(textElement('p', numClass, String(date.getDate())), dot);
  cell.addEventListener('click', () => pickDate(date));
  return cell;
}

function buildGrid() {
  if (calView === 'day') return [];
  if (calView === 'week') {
    const strip = document.createElement('div');
    strip.className = 'weekStrip';
    const first = startOfWeek(focusDate);
    strip.append(...Array.from({ length: 7 }, (_, index) => buildWeekCell(addDays(first, index))));
    return [strip];
  }
  const head = document.createElement('div');
  head.className = 'monthHead';
  head.append(...WEEKDAYS.map(name => textElement('p', 'monthHeadText', name)));
  const gridStart = startOfWeek(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1));
  const rows = Array.from({ length: 6 }, (_, week) => {
    const row = document.createElement('div');
    row.className = 'monthRow';
    row.append(...Array.from({ length: 7 }, (_, index) => buildMonthCell(addDays(gridStart, week * 7 + index))));
    return row;
  });
  return [head, ...rows];
}

function renderCalendar() {
  agendaRows.clear();
  document.querySelectorAll('[data-view]').forEach(button => setActive(button, button.dataset.view === calView, 'segmentButtonActive', 'segmentTextActive'));
  byId('calLabel').textContent = calendarTitle();
  show('todayButton', !sameDay(focusDate, dayStart(0)));
  byId('calGrid').replaceChildren(...buildGrid());
  show('agendaDate', calView !== 'day');
  byId('agendaDate').textContent = dayLabel(focusDate);
  const entries = itemsForDate(focusDate);
  byId('agenda').replaceChildren(...(entries.length ? entries.map(entry => buildAgendaItem(entry).record) : [textElement('p', 'agendaEmpty', '일정이 없어요')]));
}

function shiftCalendar(direction) {
  focusDate = calView === 'day' ? addDays(focusDate, direction) : calView === 'week' ? addDays(focusDate, 7 * direction) : addMonths(focusDate, direction);
  renderCalendar();
}

function changeView(view) {
  calView = view;
  try { localStorage.setItem('calendarView', view); } catch { /* 미리보기에서 저장이 안 돼도 동작에는 영향 없음 */ }
  renderCalendar();
}

// ---------- 하단 시트 (화면 설정 · 일정 편집) ----------
const sheets = { settings: ['settingsSheet', 'settingsBackdrop'], edit: ['editSheet', 'editBackdrop'] };

function showSheet(name, visible) {
  sheets[name].forEach(id => show(id, visible));
}

// 편집 시트가 다루는 대상: 새로 만들기(new) 또는 기존 항목 수정(edit)
let editing = null;

function applyEditType(type) {
  editing.type = type;
  show('editTimeField', type === 'EVENT');
  byId('editDateLabel').textContent = type === 'EVENT' ? '날짜' : '마감 날짜';
  byId('editHeading').textContent = editing.mode === 'new' ? (type === 'EVENT' ? '새 일정' : '새 할 일') : (type === 'EVENT' ? '일정 수정' : '할 일 수정');
  document.querySelectorAll('[data-type]').forEach(button => setActive(button, button.dataset.type === type, 'segmentButtonActive', 'segmentTextActive'));
}

function openEditSheet(mode, type, title, date, time, id) {
  editing = { mode, type, id };
  byId('editTitle').value = title;
  byId('editDate').value = dateKey(date);
  byId('editTime').value = time;
  show('editError', false);
  show('typeSegment', mode === 'new');
  show('editDelete', mode === 'edit');
  applyEditType(type);
  showSheet('edit', true);
}

function openEdit(entry) {
  const when = new Date(entry.type === 'EVENT' ? entry.item.startAt : entry.item.dueAt);
  openEditSheet('edit', entry.type, entry.item.title, when, `${pad2(when.getHours())}:${pad2(when.getMinutes())}`, entry.item.id);
}

function openNew() {
  openEditSheet('new', 'EVENT', '', focusDate, '09:00', null);
}

function closeEdit() {
  editing = null;
  showSheet('edit', false);
}

function saveEdit() {
  if (!editing) return;
  const title = byId('editTitle').value.trim();
  const date = parseDateKey(byId('editDate').value);
  const existing = editing.mode === 'edit' ? (editing.type === 'EVENT' ? mockEvents : mockTasks).find(item => item.id === editing.id) : null;
  // 할 일은 날짜만 고른다: 기존 시각은 그대로, 새로 만들면 그날 23:59 마감
  const taskClock = existing ? { hour: new Date(existing.dueAt).getHours(), minute: new Date(existing.dueAt).getMinutes() } : { hour: 23, minute: 59 };
  const clock = editing.type === 'EVENT' ? parseClock(byId('editTime').value) : taskClock;
  const error = !title ? '제목을 적어 주세요' : !date ? '날짜를 2026-10-02 처럼 적어 주세요' : !clock ? '시간을 15:00 처럼 적어 주세요' : '';
  if (error) {
    byId('editError').textContent = error;
    show('editError', false);
    show('editError', true);
    return;
  }
  const when = atTime(date, clock.hour, clock.minute);
  const now = new Date().toISOString();
  if (!existing) {
    if (editing.type === 'EVENT') mockEvents.push(makeEventAt(newId(2000), title, when, 60, null));
    else mockTasks.push(makeTaskAt(newId(2100), title, when));
  } else if (editing.type === 'EVENT') {
    const length = existing.endAt ? Date.parse(existing.endAt) - Date.parse(existing.startAt) : 3600000;
    existing.title = title;
    existing.startAt = when.toISOString();
    existing.endAt = new Date(when.getTime() + length).toISOString();
    existing.status = when.getTime() < Date.now() ? 'PAST' : 'UPCOMING';
    existing.updatedAt = now;
  } else {
    existing.title = title;
    existing.dueAt = when.toISOString();
    existing.updatedAt = now;
  }
  focusDate = startOfDay(date);
  closeEdit();
  renderCalendar();
}

function deleteEdit() {
  if (!editing || editing.mode !== 'edit') return;
  const target = (editing.type === 'EVENT' ? mockEvents : mockTasks).find(item => item.id === editing.id);
  if (target) {
    const now = new Date().toISOString();
    target.deletedAt = now;
    target.updatedAt = now;
  }
  closeEdit();
  renderCalendar();
}

// ---------- 상태별 화면 ----------
// 오늘 합계: 숫자와 "원"을 따로 그려 숫자만 크게 보여 준다 (앱에서는 중첩 Text)
function renderSummary(summary, error) {
  byId('summaryNumber').textContent = error ? '확인 필요' : summary ? summary.total.toLocaleString('ko-KR') : '—';
  byId('summaryUnit').textContent = summary && !error ? '원' : '';
  byId('summaryCaption').textContent = summary && !error ? `${summary.count}건 · 기기 현지 날짜 기준` : '기록을 확인하고 있습니다.';
}

function render(state) {
  stopScenario();
  const loading = state === 'loading';
  const error = state === 'error';
  const items = loading || error || state === 'empty' ? [] : mockTransactions;
  const summary = loading ? null : todaySummary(items);

  renderSummary(summary, error);

  // 실행취소 카드 (저장 직후)
  show('undoCard', state === 'undo');
  byId('undoLabel').textContent = `${mockTransactions[0].category || '미분류'} ${mockTransactions[0].amount.toLocaleString('ko-KR')}원 저장됨`;

  // 빠른 기록 카드
  const listening = state === 'listening';
  const review = state === 'review';
  byId('voiceButtonText').textContent = listening ? '말하기 마치기' : '말하기 시작';
  show('voiceCancel', listening);
  show('partialText', listening);
  const input = byId('captureInput');
  input.value = review ? '점심 7000원 썼어' : '';
  input.readOnly = listening;
  show('draftStatus', review);
  setDisabled('analyzeButton', listening);
  show('reviewCard', review);
  byId('reviewDate').textContent = `${new Date(localTimeIso(0, 12, 0)).toLocaleString('ko-KR')} · 지출`;
  setDisabled('manualButton', listening);
  show('discardButton', review);

  // 로딩 / 오류 / 빈 목록 / 목록
  show('loadingIndicator', loading);
  show('errorBox', error);
  show('emptyCard', !loading && !error && items.length === 0);
  const list = byId('recordList');
  list.replaceChildren(...items.map(renderRecord));
  list.hidden = items.length === 0;

  renderCalendar();
  renderOverlay(state);
  highlight('[data-state]', button => button.dataset.state === state);
}

// ---------- 첫 화면: 녹음 오버레이 (앱에서는 Modal) ----------
// 앱의 실제 음성 상태에 맞춘 3가지. 이유 문구는 voice-expense-capture.ts 의 기존 문구를 재사용했다.
// 오버레이가 보일 때 뒤의 홈은 위 render() 가 "기본" 상태로 그린다 (start* 는 기존 분기에 걸리지 않음).
// 부가 설명은 두지 않는다: 사용 불가일 때만 이유를 한 줄 보여 준다.
const overlayStates = {
  // LISTENING: 실제로 듣는 중
  start: { chip: '녹음 중', message: '', button: '녹음 그만하고 화면으로 가기', recording: true, sleepy: false },
  // CHECKING: 마이크 권한 확인 중 (앱 첫 실행 때 권한 팝업이 뜨는 구간)
  startChecking: { chip: '마이크 확인 중', message: '', button: '화면으로 가기', recording: false, sleepy: true },
  // 사용 불가: 권한 거부, 오프라인 음성 인식 미지원, 웹 등
  startUnavailable: { chip: '녹음할 수 없어요', message: '이 기기에서 오프라인 음성 인식을 사용할 수 없어요.', button: '화면으로 가기', recording: false, sleepy: false },
};

// 동작 줄이기: 시스템 설정 + 확인용 토글. 앱에서는 reanimated 의 useReducedMotion().
const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let reducedMotion = motionQuery ? motionQuery.matches : false;
let overlayRecording = false;

// data-anim="listen": 녹음 중일 때만 움직임 (튀기, 물결, 빨간 점)
// data-anim="always": 녹음 상태와 무관 (눈 깜빡임, 갸웃, 연필). 동작 줄이기에서는 둘 다 멈춘다.
function applyMotion() {
  document.querySelectorAll('[data-anim]').forEach(element => {
    const still = reducedMotion || (element.dataset.anim === 'listen' && !overlayRecording);
    element.classList.toggle('still', still);
  });
  highlight('[data-motion]', () => reducedMotion);
}

// 디자인 확인용 패널: 평소에는 접어 두고, 첫 화면·시나리오를 시작하면 자동으로 접어 화면을 넓게 쓴다
function setBarOpen(open) {
  show('designPanel', open);
  byId('designToggleText').textContent = open ? '접기' : '펼치기';
  byId('designToggle').setAttribute('aria-expanded', String(open));
  fitOverlay();
  onPageScroll();
}

function renderOverlay(state) {
  const config = overlayStates[state];
  const overlay = byId('startOverlay');
  overlay.classList.toggle('overlayFade', false);
  if (config) setBarOpen(false);
  show('startOverlay', Boolean(config));
  if (config) fitOverlay();
  if (!config) {
    show('pet', false);
    return;
  }
  overlay.setAttribute('aria-label', config.chip);
  byId('overlayChip').textContent = config.chip;
  byId('overlayPhrase').textContent = config.message;
  show('overlayPhrase', Boolean(config.message));
  byId('overlayButtonText').textContent = config.button;
  byId('chipDot').classList.toggle('chipDotIdle', !config.recording);
  document.querySelectorAll('[data-eye]').forEach(eye => eye.classList.toggle('eyeSleepy', config.sleepy));
  overlayRecording = config.recording;
  applyMotion();

  // 캐릭터를 오버레이 자리에 앉힌다 (오버레이를 먼저 보이게 해야 자리를 잴 수 있다)
  resetPet();
  show('pet', true);
  placePetAtStage();
}

// ---------- 캐릭터 연출 ----------
// pet 은 화면 전체 기준(fixed)이라 오버레이가 사라진 뒤에도 남아 목록 위로 날아갈 수 있다.
// 앱에서는 reanimated 의 translate/scale 값과 onLayout 으로 잰 위치로 옮긴다.
const PET_W = 144; // 통통한 몸: 가로가 세로보다 조금 길다
const PET_H = 126;
let petPose = { cx: 0, cy: 0, scale: 1, rotate: 0 };
let petAtStage = false;
let overlayFrozen = false; // 시나리오가 스크롤하는 동안 오버레이 위치가 바뀌어 튀지 않게 고정
let runId = 0;
let pendingAnswer = null;

const poseTransform = pose => `translate(${pose.cx - PET_W / 2}px, ${pose.cy - PET_H / 2}px) rotate(${pose.rotate}deg) scale(${pose.scale})`;

const NOD = [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.07, 0.92)' }, { transform: 'scale(0.97, 1.05)' }, { transform: 'scale(1, 1)' }];
const LAND = [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.14, 0.84)' }, { transform: 'scale(1, 1)' }];
const HOP = [{ transform: 'translateY(0px)' }, { transform: 'translateY(-18px)' }, { transform: 'translateY(0px)' }];
const SHAKE = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)' }, { transform: 'rotate(9deg)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(0deg)' }];
const FLIP_TO_BACK = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }];
const FLIP_TO_FRONT = [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }];
const SLUMP = [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.1, 0.88)' }]; // 풀 죽어 납작하게 가라앉기
const UNSLUMP = [{ transform: 'scale(1.1, 0.88)' }, { transform: 'scale(1, 1)' }];

// 기다림: 동작 줄이기에서는 길게 기다리지 않는다
const wait = ms => new Promise(resolve => setTimeout(resolve, reducedMotion ? Math.min(ms, 300) : ms));

// 움직임 한 번: 끝나면 마지막 값을 실제 스타일로 확정한다. 동작 줄이기에서는 움직임 없이 바로 확정.
function animate(element, frames, ms, easing = 'ease-in-out') {
  const last = frames[frames.length - 1];
  if (reducedMotion || typeof element.animate !== 'function') {
    Object.assign(element.style, last);
    return Promise.resolve();
  }
  const run = element.animate(frames, { duration: ms, easing, fill: 'forwards' });
  const finish = () => { Object.assign(element.style, last); run.cancel(); };
  return run.finished.then(finish, () => {});
}

function placePet(cx, cy, scale) {
  petPose = { cx, cy, scale, rotate: 0 };
  const pet = byId('pet');
  pet.style.opacity = '1';
  pet.style.transform = poseTransform(petPose);
}

function stageCenter() {
  const rect = byId('petStage').getBoundingClientRect();
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
}

function placePetAtStage() {
  const { cx, cy } = stageCenter();
  placePet(cx, cy, 1);
  petAtStage = true;
}

// 디자인 확인용: 오버레이는 확인용 패널 아래에서 시작한다. 패널이 스크롤로 사라지면 맨 위부터 덮는다.
// (앱에는 이 패널이 없으므로 변환하지 않는다)
function fitOverlay() {
  if (overlayFrozen) return;
  const barBottom = Math.max(0, Math.round(byId('designBar').getBoundingClientRect().bottom));
  byId('startOverlay').style.top = `${barBottom}px`;
}

// 글씨 크기나 창 크기가 바뀌면 오버레이 안의 캐릭터 자리도 옮겨진다
function settlePet() {
  if (petAtStage && !byId('startOverlay').hidden && !overlayFrozen) placePetAtStage();
}

// 통통 튀는 정도: 평소(녹음 중)는 크게 튀고, 적거나 물어볼 때는 살짝만 출렁인다
function setJelly(soft) {
  byId('petJelly').classList.toggle('jellyBounce', !soft);
  byId('petJelly').classList.toggle('jellySoft', soft);
}

// 디자인 확인용: 확인용 패널이 화면 밖이면 "위로" 버튼을 보여 준다
function onPageScroll() {
  byId('designTop').hidden = byId('designBar').getBoundingClientRect().bottom > 0;
  if (!byId('startOverlay').hidden) {
    fitOverlay();
    settlePet();
  }
}

// 이전 연출의 흔적(뒤돌기, 연필, 말풍선, 진행 중인 움직임)을 모두 지운다
function resetPet() {
  ['pet', 'petBob', 'petTurn', 'bubble'].forEach(id => {
    const element = byId(id);
    if (typeof element.getAnimations === 'function') element.getAnimations().forEach(run => run.cancel());
  });
  byId('petBob').style.transform = '';
  byId('petTurn').style.transform = '';
  byId('bubble').style.transform = '';
  byId('bubble').style.opacity = '';
  byId('bubble').hidden = true;
  byId('pencil').hidden = true;
  byId('petArm').classList.toggle('armWrite', false);
  byId('petTilt').classList.toggle('petSway', false);
  setJelly(false);
}

// 진행 중인 시나리오를 취소한다 (다른 상태 버튼을 누르거나 다시 시작할 때)
function stopScenario() {
  runId++;
  overlayFrozen = false;
  pendingAnswer = null;
  byId('bubble').hidden = true;
  byId('petTilt').classList.toggle('petSway', false);
}

// 부채꼴로 날아가기: 출발 → 위로 솟은 중간 지점 → 도착. 날면서 크기가 줄고 살짝 기운다.
function flyTo(cx, cy, scale, ms) {
  petAtStage = false;
  const from = petPose;
  const mid = { cx: (from.cx + cx) / 2, cy: Math.min(from.cy, cy) - 90, scale: (from.scale + scale) / 2, rotate: from.cx < cx ? -10 : 10 };
  const to = { cx, cy, scale, rotate: 0 };
  petPose = to;
  return animate(byId('pet'), [{ transform: poseTransform(from) }, { transform: poseTransform(mid) }, { transform: poseTransform(to) }], ms, 'cubic-bezier(0.4, 0, 0.2, 1)');
}

// 작아지며 사라지기
function vanish() {
  const small = { ...petPose, scale: 0 };
  return animate(byId('pet'), [{ transform: poseTransform(petPose), opacity: '1' }, { transform: poseTransform(small), opacity: '0' }], 320, 'ease-in');
}

async function fadeOutOverlay(alive) {
  const overlay = byId('startOverlay');
  if (reducedMotion) {
    show('startOverlay', false);
    return;
  }
  overlay.classList.toggle('overlayFade', true);
  await wait(600);
  if (alive()) {
    show('startOverlay', false);
    overlay.classList.toggle('overlayFade', false);
  }
}

// 목록 맨 위에 빈 줄(적을 자리)을 만든다. 캐릭터가 옆에 설 수 있게 글자가 오른쪽으로 비켜 있다.
function openSlot(tx) {
  const built = buildRecord(tx);
  built.parts.forEach(part => { part.textContent = ''; });
  built.record.classList.toggle('recordWriting', true);
  const list = byId('recordList');
  list.hidden = false;
  list.prepend(built.record);
  return built;
}

function scrollSlotIntoView(record) {
  const rect = record.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.4));
}

function slotSpot(record) {
  const rect = record.getBoundingClientRect();
  return { cx: rect.left + 38, cy: rect.top + 50 };
}

async function typeInto(element, text, perChar, alive) {
  if (reducedMotion) {
    element.textContent = text;
    return;
  }
  for (let i = 1; i <= text.length; i++) {
    if (!alive()) return;
    element.textContent = text.slice(0, i);
    await wait(perChar);
  }
}

// 확인 말풍선: 캐릭터 머리 위에 뜨고, 사용자의 대답을 기다린다
function placeBubble() {
  const bubble = byId('bubble');
  const box = bubble.getBoundingClientRect();
  const radius = (PET_H / 2) * petPose.scale;
  const left = Math.min(Math.max(petPose.cx - 40, 12), window.innerWidth - box.width - 12);
  const top = Math.max(petPose.cy - radius - 16 - box.height, 8);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  byId('bubbleTail').style.left = `${Math.min(Math.max(petPose.cx - left - 8, 18), box.width - 34)}px`;
}

// 말풍선: 버튼 글자는 [왼쪽(눈에 띄는 쪽) = 'yes', 오른쪽 = 'no'] 순서. sway=false 면 갸웃거리지 않는다.
function ask(message, labels = ['맞아요', '아니에요'], sway = true) {
  return new Promise(resolve => {
    pendingAnswer = resolve;
    byId('bubbleText').textContent = message;
    byId('bubbleYesText').textContent = labels[0];
    byId('bubbleNoText').textContent = labels[1];
    const bubble = byId('bubble');
    bubble.hidden = false;
    placeBubble();
    byId('petTilt').classList.toggle('petSway', sway);
    setJelly(true);
    void animate(bubble, [{ transform: 'scale(0.85)', opacity: '0' }, { transform: 'scale(1)', opacity: '1' }], 220, 'ease-out');
  });
}

function answer(value) {
  if (!pendingAnswer) return;
  const resolve = pendingAnswer;
  pendingAnswer = null;
  byId('bubble').hidden = true;
  byId('petTilt').classList.toggle('petSway', false);
  resolve(value);
}

// 뒤돌아서 연필로 한 글자씩 적고, 다시 돌아서 두 번 통통 뛴다
async function writeRecord(slot, tx, alive) {
  const turn = byId('petTurn');
  setJelly(true);
  await animate(turn, FLIP_TO_BACK, 450);
  if (!alive()) return;
  byId('pencil').hidden = false;
  byId('petArm').classList.toggle('armWrite', true);
  const [title, amount, memo, meta] = slot.parts;
  await typeInto(title, tx.category ?? '미분류', 80, alive);
  await typeInto(amount, formatAmount(tx), 80, alive);
  await typeInto(memo, tx.memo ?? '메모 없음', 80, alive);
  await typeInto(meta, formatMeta(tx), 18, alive);
  if (!alive()) return;
  byId('petArm').classList.toggle('armWrite', false);
  byId('pencil').hidden = true;
  await animate(turn, FLIP_TO_FRONT, 450);
  if (!alive()) return;
  slot.record.classList.toggle('recordWriting', false);
  mockTransactions.unshift(tx);
  renderSummary(todaySummary(mockTransactions), false);
  await animate(byId('petBob'), HOP, 320);
  await animate(byId('petBob'), HOP, 320);
}

// 캘린더의 해당 날짜로 넘기고, 그 날 목록 맨 위에 빈 줄(적을 자리)을 만든다
function openAgendaSlot(entry) {
  focusDate = startOfDay(entry.date);
  renderCalendar();
  const built = buildAgendaItem(entry);
  built.parts.forEach(part => { part.textContent = ''; });
  built.record.classList.toggle('agendaWriting', true);
  byId('agenda').replaceChildren(built.record, ...itemsForDate(entry.date).map(item => buildAgendaItem(item).record));
  return built;
}

// 뒤돌아서 연필로 시각과 제목을 한 글자씩 적고, 날짜 칸에 점이 생기고, 다시 돌아서 두 번 통통 뛴다
async function writeAgenda(slot, entry, alive) {
  const turn = byId('petTurn');
  setJelly(true);
  await animate(turn, FLIP_TO_BACK, 450);
  if (!alive()) return;
  byId('pencil').hidden = false;
  byId('petArm').classList.toggle('armWrite', true);
  const [label, title] = slot.parts;
  await typeInto(label, agendaLabel(entry), 80, alive);
  await typeInto(title, entry.item.title, 80, alive);
  if (!alive()) return;
  byId('petArm').classList.toggle('armWrite', false);
  byId('pencil').hidden = true;
  await animate(turn, FLIP_TO_FRONT, 450);
  if (!alive()) return;
  (entry.type === 'EVENT' ? mockEvents : mockTasks).push(entry.item);
  renderCalendar();
  await animate(byId('petBob'), HOP, 320);
  await animate(byId('petBob'), HOP, 320);
}

// 말로 "끝났어"라고 하면: 그 할 일 줄로 날아가 옆에 서고
function openCompleteSlot(thing) {
  const task = mockTasks.find(item => item.id === thing.taskId);
  focusDate = startOfDay(new Date(task.dueAt));
  renderCalendar();
  const record = agendaRows.get(task.id);
  record.classList.toggle('agendaWriting', true);
  return { record, parts: [] };
}

// 뒤돌아서 연필로 체크 표시를 긋고 → 체크 칸이 채워지고 → 다시 돌아서 두 번 통통 뛴다 (사람 대신 캐릭터가 체크한다)
async function writeComplete(slot, thing, alive) {
  const turn = byId('petTurn');
  setJelly(true);
  await animate(turn, FLIP_TO_BACK, 450);
  if (!alive()) return;
  byId('pencil').hidden = false;
  byId('petArm').classList.toggle('armWrite', true);
  await wait(1000);
  if (!alive()) return;
  byId('petArm').classList.toggle('armWrite', false);
  byId('pencil').hidden = true;
  await animate(turn, FLIP_TO_FRONT, 450);
  if (!alive()) return;
  setTaskDone(thing.taskId, true);
  await animate(byId('petBob'), HOP, 320);
  await animate(byId('petBob'), HOP, 320);
}

// 목록을 원래 기록들로 다시 그린다 (캐릭터가 적으려고 만든 빈 줄을 치운다)
function rebuildList() {
  const list = byId('recordList');
  list.replaceChildren(...mockTransactions.map(renderRecord));
  list.hidden = mockTransactions.length === 0;
}

// 삐짐: 고개를 젓고 → 천천히 등을 돌리고 → 풀 죽어 납작하게 가라앉는다
async function sulk(alive) {
  const bob = byId('petBob');
  await animate(bob, SHAKE, 520);
  if (!alive()) return;
  await animate(byId('petTurn'), FLIP_TO_BACK, 700);
  if (!alive()) return;
  await animate(bob, SLUMP, 450);
}

// "직접 적기": 다시 앞을 보고 → 직접 입력하는 칸으로 날아가 → 통통 뛰고 사라진 뒤 → 그 칸에 커서를 둔다
async function goManual(alive) {
  const bob = byId('petBob');
  await animate(bob, UNSLUMP, 250);
  if (!alive()) return;
  await animate(byId('petTurn'), FLIP_TO_FRONT, 450);
  if (!alive()) return;
  rebuildList();
  const input = byId('captureInput');
  window.scrollTo(0, Math.max(0, window.scrollY + input.getBoundingClientRect().top - window.innerHeight * 0.4));
  const rect = input.getBoundingClientRect();
  await flyTo(rect.left + 40, rect.top - 30, 0.5, 900);
  if (!alive()) return;
  await animate(bob, HOP, 320);
  if (!alive()) return;
  await vanish();
  if (!alive()) return;
  show('pet', false);
  input.focus();
}

// "다시 말하기": 다시 앞을 보고 → 첫 화면 오버레이가 다시 덮이며 → 제자리로 날아가 다시 듣는다
async function goRetry(alive) {
  await animate(byId('petBob'), UNSLUMP, 250);
  if (!alive()) return;
  await animate(byId('petTurn'), FLIP_TO_FRONT, 450);
  if (!alive()) return;
  rebuildList();
  overlayFrozen = false;
  window.scrollTo(0, 0);
  const overlay = byId('startOverlay');
  overlay.classList.toggle('overlayFade', false);
  show('startOverlay', true);
  fitOverlay();
  const stage = stageCenter();
  void animate(overlay, [{ opacity: '0' }, { opacity: '1' }], 500, 'ease-out').then(() => { overlay.style.opacity = ''; });
  await flyTo(stage.cx, stage.cy, 1, 900);
  if (alive()) render('start'); // 다시 듣는 중 상태로 정리 (캐릭터는 이미 그 자리에 있다)
}

// 시나리오: 캐릭터가 말을 듣고 → 적을 자리로 날아가서 → (애매하면 물어보고) → 뒤돌아 대신 적는다.
// 말로 시킨 일은 항상 캐릭터가 사람 대신 한다.
// target: 'expense'(최근 기록) · 'calendar'(캘린더에 적기) · 'complete'(할 일 체크). question 이 있으면 적기 전에 말풍선으로 묻는다.
function newVoiceTransaction(amount, category, memo, rawInput) {
  const now = new Date();
  return makeTransaction(newId(6), amount, category, memo, 0, now.getHours(), now.getMinutes(), 'VOICE', rawInput);
}

function newCalendarEvent(title, offset, hour, minute) {
  const date = dayStart(offset);
  return { type: 'EVENT', date, item: makeEventAt(newId(2000), title, atTime(date, hour, minute), 60, null) };
}

function newCalendarTask(title, offset) {
  const date = dayStart(offset);
  return { type: 'TASK', date, item: makeTaskAt(newId(2100), title, atTime(date, 23, 59)) };
}

// "7시" 처럼 오전/오후가 모호한 시간을 사용자가 고른 시각으로 바꾼다
function withHour(entry, hour) {
  const start = atTime(entry.date, hour, 0);
  return { ...entry, item: { ...entry.item, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600000).toISOString(), status: start.getTime() < Date.now() ? 'PAST' : 'UPCOMING' } };
}

const targets = {
  expense: { open: openSlot, write: writeRecord },
  calendar: { open: openAgendaSlot, write: writeAgenda },
  complete: { open: openCompleteSlot, write: writeComplete },
};

const scenarios = {
  // 분명한 지출: 바로 적는다
  clear: { target: 'expense', build: () => newVoiceTransaction(12000, '식비', '저녁', '저녁 만이천 원 썼어') },
  // 애매한 지출: 먼저 확인 메시지를 보낸다. "아니에요"를 누르면 삐진다.
  confirm: {
    target: 'expense',
    build: () => newVoiceTransaction(7000, '식비', '점심', '점심 칠천 원'),
    question: { text: tx => `${tx.memo} ${tx.amount.toLocaleString('ko-KR')}원, 맞나요?`, labels: ['맞아요', '아니에요'], sulkOnNo: true },
  },
  // 분명한 약속: "내일 오후 3시에 치과 예약" → 내일 칸에 일정으로 적는다
  event: { target: 'calendar', build: () => newCalendarEvent('치과 예약', 1, 15, 0) },
  // 분명한 할 일: "모레까지 보고서 제출" → 모레 칸에 할 일로 적는다
  task: { target: 'calendar', build: () => newCalendarTask('보고서 제출', 2) },
  // 애매한 시간: "내일 7시에 약속" 은 오전인지 오후인지 마음대로 정하지 않고 묻는다 (제품 결정 2번)
  time: {
    target: 'calendar',
    build: () => newCalendarEvent('약속', 1, 19, 0),
    question: { text: () => '내일 7시, 오전인가요 오후인가요?', labels: ['오후 7시', '오전 7시'], resolve: (entry, reply) => withHour(entry, reply === 'yes' ? 19 : 7) },
  },
  // 할 일 완료: "택배 보내기 끝났어" → 캐릭터가 그 할 일 옆에서 체크해 준다
  done: { target: 'complete', build: () => ({ taskId: baseTasks[0].id }) },
};

async function runScenario(kind) {
  restoreTransactions();
  window.scrollTo(0, 0);
  render('start');
  const id = ++runId;
  const alive = () => id === runId;
  const spec = scenarios[kind];
  const target = targets[spec.target];
  let thing = spec.build();
  const bob = byId('petBob');

  await wait(1800); // 듣는 중
  if (!alive()) return;
  await animate(bob, NOD, 480); // 알아들었다는 끄덕임
  if (!alive()) return;

  // 오버레이가 아직 덮고 있을 때 자리를 만들고 스크롤해 두면 화면이 튀는 모습이 보이지 않는다
  const slot = target.open(thing);
  overlayFrozen = true;
  scrollSlotIntoView(slot.record);
  const spot = slotSpot(slot.record);
  void fadeOutOverlay(alive);
  await flyTo(spot.cx, spot.cy, 0.5, 1100);
  if (!alive()) return;
  await animate(bob, LAND, 260);
  if (!alive()) return;

  if (spec.question) {
    const reply = await ask(spec.question.text(thing), spec.question.labels);
    if (!alive()) return;
    if (reply === 'no' && spec.question.sulkOnNo) {
      // 입력할 곳·방법을 몰라 사용자가 "아니에요"를 누르면 삐져서 등을 돌리고, 직접 적을지 다시 말할지 묻는다
      await sulk(alive);
      if (!alive()) return;
      const choice = await ask('모르겠어요', ['직접 적기', '다시 말하기'], false);
      if (!alive()) return;
      await (choice === 'yes' ? goManual(alive) : goRetry(alive));
      return;
    }
    if (spec.question.resolve) thing = spec.question.resolve(thing, reply);
    await animate(bob, NOD, 480);
    if (!alive()) return;
  }

  await target.write(slot, thing, alive);
  if (!alive()) return;
  await vanish();
  if (alive()) render('default');
}

// ---------- 글씨 크기 (앱에서는 fontScale 로 모든 fontSize 에 곱한다) ----------
const fontScales = [0.9, 1, 1.2];

function loadFontScale() {
  try {
    const saved = Number(localStorage.getItem('fontScale'));
    return fontScales.includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

function applyFontScale(scale, save) {
  document.documentElement.style.setProperty('--fs', String(scale));
  document.querySelectorAll('[data-size]').forEach(button => setActive(button, Number(button.dataset.size) === scale, 'sizeButtonActive', 'sizeTextActive'));
  if (save) {
    try { localStorage.setItem('fontScale', String(scale)); } catch { /* 미리보기에서 저장이 안 돼도 동작에는 영향 없음 */ }
  }
  settlePet();
}

// ---------- 색 고르기: 포인트 색 + 바탕색 두 가지만 고르면 나머지는 자동으로 만든다 ----------
// 라이트/다크 모드 대신 사용자가 직접 고른다. 밝은 바탕이든 어두운 바탕이든 글자 대비가 모자라지 않게 보정한다.
const hexToRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const rgbToHex = rgb => `#${rgb.map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
// a 에서 b 쪽으로 amount(0~1)만큼 섞는다
const mix = (a, b, amount) => {
  const from = hexToRgb(a), to = hexToRgb(b);
  return rgbToHex(from.map((value, index) => value * (1 - amount) + to[index] * amount));
};
const luminance = hex => {
  const [r, g, b] = hexToRgb(hex).map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastRatio = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hslToHex(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const part = (hue / 60) % 6;
  const second = chroma * (1 - Math.abs((part % 2) - 1));
  const [r, g, b] = [[chroma, second, 0], [second, chroma, 0], [0, chroma, second], [0, second, chroma], [second, 0, chroma], [chroma, 0, second]][Math.floor(part)];
  const offset = lightness - chroma / 2;
  return rgbToHex([r + offset, g + offset, b + offset].map(value => value * 255));
}

// fg 가 bg 위에서 min 대비를 못 넘으면, 색상과 채도는 그대로 두고 밝기만 조금씩 옮겨 맞춘다 (검정과 섞는 방식보다 색이 탁해지지 않는다).
// direction: -1 = 어둡게, +1 = 밝게. 같은 글자색이 여러 면 위에 놓일 때는 방향을 하나로 정해서 서로 엇갈리지 않게 한다.
function ensureContrast(fg, bg, min, direction = luminance(bg) > 0.18 ? -1 : 1) {
  if (contrastRatio(fg, bg) >= min) return fg;
  const [hue, saturation, lightness] = hexToHsl(fg);
  for (let step = 1; step <= 40; step++) {
    const candidate = hslToHex(hue, saturation, Math.min(1, Math.max(0, lightness + direction * step * 0.025)));
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return direction < 0 ? '#000000' : '#FFFFFF';
}

const ensureOnAll = (fg, backgrounds, min, direction) => backgrounds.reduce((color, bg) => ensureContrast(color, bg, min, direction), fg);

// 글자(검정/흰색)가 4.5 대비를 낼 수 있는 밝기 안으로 면을 맞춘다. 중간 밝기 바탕에서 면들이 서로 다른 쪽으로 치우치지 않게 한다.
function fitSurface(color, light) {
  let result = color;
  for (let step = 0; step < 20; step++) {
    const lum = luminance(result);
    if (light ? lum >= 0.19 : lum <= 0.17) break;
    result = mix(result, light ? '#FFFFFF' : '#000000', 0.1);
  }
  return result;
}

function buildPalette(accentColor, base) {
  const light = luminance(base) > 0.18; // 밝은 바탕이면 어두운 글자, 어두운 바탕이면 밝은 글자
  const textDir = light ? -1 : 1;
  const canvas = base;
  const paper = fitSurface(light ? mix(base, '#FFFFFF', 0.65) : mix(base, '#FFFFFF', 0.06), light);
  const inputFill = fitSurface(light ? mix(paper, '#000000', 0.05) : mix(paper, '#000000', 0.12), light);
  const reviewFill = fitSurface(mix(paper, accentColor, 0.12), light);
  const nowFill = fitSurface(mix(canvas, accentColor, 0.16), light);
  const surfaces = [canvas, paper, inputFill, reviewFill];
  const inkSeed = light ? mix(accentColor, '#000000', 0.82) : mix(accentColor, '#FFFFFF', 0.9);
  const ink = ensureOnAll(inkSeed, surfaces, 10, textDir);
  const line = mix(canvas, ink, 0.13);
  const muted = ensureOnAll(mix(ink, canvas, 0.38), surfaces, 4.5, textDir);
  const accent = ensureOnAll(accentColor, surfaces, 4.5, textDir);
  const placeholder = ensureContrast(mix(ink, inputFill, 0.45), inputFill, 4.5, textDir);
  const danger = ensureOnAll('#C0392B', surfaces, 4.5, textDir);

  // 버튼·히어로 면: 포인트 색 그대로 두고, 그 위 글자는 흰색/짙은색 중 잘 보이는 쪽. 그래도 모자라면 면의 밝기를 조금 조정한다.
  const darkText = mix(accentColor, '#000000', 0.85);
  const onPrimary = contrastRatio('#FFFFFF', accentColor) >= contrastRatio(darkText, accentColor) ? '#FFFFFF' : darkText;
  const fillDir = luminance(onPrimary) > 0.5 ? -1 : 1; // 글자가 흰색이면 면을 어둡게, 짙은색이면 면을 밝게
  const primaryFill = ensureContrast(accentColor, onPrimary, 4.5, fillDir);
  const heroMuted = ensureContrast(mix(onPrimary, primaryFill, 0.3), primaryFill, 4.5, -fillDir);

  const petBody = light ? '#17151C' : '#050507';
  const petRim = light ? petBody : ensureContrast(mix(canvas, '#FFFFFF', 0.5), canvas, 3, 1);

  return {
    ink, muted, accent, primaryFill, onPrimary, canvas, paper, line, danger, inputFill, placeholder,
    heroFill: primaryFill, heroInk: onPrimary, heroMuted, reviewFill, nowFill,
    dangerFill: mix(paper, danger, 0.1), dangerLine: mix(paper, danger, 0.4),
    overlayFill: `${canvas}EE`, petBody, petRim, petEye: '#FFFFFF',
  };
}

const ACCENT_PRESETS = [['연보라', '#B8A7F2'], ['분홍', '#F2A7C8'], ['하늘', '#9CCBF2'], ['민트', '#9DE0C6'], ['살구', '#F5BC9A'], ['진보라', '#6D56C9']];
const BASE_PRESETS = [['연보라', '#F4F1FB'], ['흰색', '#FFFFFF'], ['크림', '#F7F2E8'], ['연회색', '#F1F2F5'], ['밤', '#18161F']];
const DEFAULT_COLORS = { accent: ACCENT_PRESETS[0][1], base: BASE_PRESETS[0][1] };
let colors = { ...DEFAULT_COLORS };
const swatchRefs = {};

function loadColors() {
  try {
    const saved = JSON.parse(localStorage.getItem('themeColors'));
    const valid = value => typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
    return saved && valid(saved.accent) && valid(saved.base) ? { accent: saved.accent.toUpperCase(), base: saved.base.toUpperCase() } : { ...DEFAULT_COLORS };
  } catch {
    return { ...DEFAULT_COLORS };
  }
}

// 고른 색 견본에 테두리를 붙이고, 직접 고른 색이면 "직접 고르기" 칸을 눌린 모양으로
function updateSwatches() {
  Object.entries(swatchRefs).forEach(([key, ref]) => {
    const presets = key === 'accent' ? ACCENT_PRESETS : BASE_PRESETS;
    let matched = false;
    ref.buttons.forEach((button, index) => {
      const on = presets[index][1] === colors[key];
      matched = matched || on;
      button.classList.toggle('swatchOn', on);
      button.setAttribute('aria-pressed', String(on));
    });
    ref.custom.classList.toggle('swatchCustomOn', !matched);
    if (ref.input.value.toUpperCase() !== colors[key]) ref.input.value = colors[key];
  });
}

function applyColors(next, save) {
  colors = { accent: next.accent.toUpperCase(), base: next.base.toUpperCase() };
  Object.entries(buildPalette(colors.accent, colors.base)).forEach(([key, value]) => document.documentElement.style.setProperty(`--${key}`, value));
  updateSwatches();
  if (save) {
    try { localStorage.setItem('themeColors', JSON.stringify(colors)); } catch { /* 미리보기에서 저장이 안 돼도 동작에는 영향 없음 */ }
  }
}

// 견본 줄: 프리셋 동그라미들 + 마지막에 색 선택기(직접 고르기). 선택기는 한 번만 만들어 둔다 (고르는 동안 다시 그리면 닫혀 버린다)
function buildSwatchRow(rowId, key, label, presets) {
  const buttons = presets.map(([name, color]) => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.setAttribute('aria-label', `${label} ${name}`);
    const dot = document.createElement('div');
    dot.className = 'swatchDot';
    dot.style.backgroundColor = color;
    button.append(dot);
    button.addEventListener('click', () => applyColors({ ...colors, [key]: color }, true));
    return button;
  });
  const custom = document.createElement('div');
  custom.className = 'swatchCustom';
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'colorInput';
  input.setAttribute('aria-label', `${label} 직접 고르기`);
  input.addEventListener('input', () => applyColors({ ...colors, [key]: input.value }, true));
  custom.append(input);
  byId(rowId).replaceChildren(...buttons, custom);
  swatchRefs[key] = { buttons, custom, input };
}

// ======================================================================
// 요금제 · 설정 · 가족·친구 (백엔드 연결 전 목업)
// 아래 데이터는 앱의 실제 타입이 아직 없다. 백엔드 설계가 정해지면 필드 이름이 바뀔 수 있는 "임시 형태"이다.
// 알림 값은 앱의 Reminder.relativeOffsetMinutes 와 같은 부호 규칙: 0 = 정시, -60 = 1시간 전.
// ======================================================================
const REMINDER_OFFSETS = [0, -10, -30, -60, -1440];
const reminderLabel = minutes => (minutes === 0 ? '정시' : minutes === -60 ? '1시간 전' : minutes === -1440 ? '하루 전' : `${Math.abs(minutes)}분 전`);
const reminderListLabel = list => (list.length ? [...list].sort((a, b) => b - a).map(reminderLabel).join(', ') : '알림 없음');

// receiveMode: "이 사람이 보낸 일정"을 내가 어떻게 처리하는지
const RECEIVE_MODES = {
  ASK: { label: '매번 확인', hint: '일정이 오면 내가 직접 수락하거나 거부해요.' },
  AUTO_ACCEPT: { label: '항상 수락', hint: '이 사람이 보낸 일정은 바로 내 캘린더에 들어가요.' },
  AUTO_REJECT: { label: '항상 거부', hint: '이 사람이 보낸 일정은 받지 않아요. 상대에게는 "거절됨"으로만 보여요.' },
};
const RELATION_LABEL = { FAMILY: '가족', FRIEND: '친구' };

// ---------- 계정(요금제) 상태 ----------
const PLAN_INFO = {
  FREE: { name: '무료', price: '0원' },
  MONTHLY: { name: '월 구독', price: '월 2,990원' },
  UNLIMITED: { name: '무제한', price: '월 7,900원' }, // 예시 가격: 아직 정해지지 않았다
};
const PLAN_FEATURES = {
  FREE: [['on', 'AI 해석 체험 3회 (사용한 횟수는 다시 채워지지 않아요)'], ['on', '직접 입력과 간단한 문장 해석은 제한 없음'], ['off', '가족·친구에게 일정 보내기 (구독 전용)']],
  MONTHLY: [['on', 'AI 해석 매달 300회'], ['on', '가족·친구에게 일정 보내기'], ['on', '받는 사람의 알림 시각 정하기']],
  UNLIMITED: [['on', 'AI 해석 횟수 제한 없음'], ['on', '월 구독의 모든 기능']],
};
const PLAN_KEY = { FREE: 'free', MONTHLY: 'monthly', UNLIMITED: 'unlimited' };
const ACCOUNT_PRESETS = {
  free: { plan: 'FREE', aiUsed: 1, aiLimit: 3, limitKind: 'LIFETIME' },
  freeOut: { plan: 'FREE', aiUsed: 3, aiLimit: 3, limitKind: 'LIFETIME' },
  monthly: { plan: 'MONTHLY', aiUsed: 118, aiLimit: 300, limitKind: 'MONTHLY' },
  monthlyOut: { plan: 'MONTHLY', aiUsed: 300, aiLimit: 300, limitKind: 'MONTHLY' },
  unlimited: { plan: 'UNLIMITED', aiUsed: 412, aiLimit: null, limitKind: null },
};
let accountKey = 'free';
let account = { ...ACCOUNT_PRESETS.free };
const isPaid = () => account.plan !== 'FREE';
const aiRemaining = () => (account.aiLimit === null ? Infinity : Math.max(0, account.aiLimit - account.aiUsed));

function nextResetLabel() {
  const next = addMonths(startOfDay(new Date()), 1);
  return `${next.getMonth() + 1}월 1일`;
}

function usageView() {
  if (account.aiLimit === null) {
    return { label: '이번 달 AI 해석', number: '무제한', unit: '', ratio: 0, caption: `이번 달 ${account.aiUsed}회 사용`, meter: false };
  }
  const ratio = account.aiUsed / account.aiLimit;
  if (account.limitKind === 'LIFETIME') {
    return { label: '무료 체험 AI 해석', number: String(aiRemaining()), unit: '회 남음', ratio, caption: `체험 ${account.aiLimit}회 중 ${account.aiUsed}회 사용 · 사용한 횟수는 다시 채워지지 않아요`, meter: true };
  }
  return { label: '이번 달 AI 해석', number: String(aiRemaining()), unit: '회 남음', ratio, caption: `${account.aiUsed} / ${account.aiLimit}회 사용 · ${nextResetLabel()}에 초기화돼요`, meter: true };
}

// ---------- 사람 목록 (목업) ----------
// theirReceiveMode: 상대가 "내가 보낸 일정"을 처리하는 방식. 실제로는 보내는 쪽에 공개되지 않고 결과(수락됨/대기/거절됨)로만 보인다.
const mockPeople = [
  { id: 'p-mom', displayName: '어머니', relation: 'FAMILY', status: 'CONNECTED', receiveMode: 'AUTO_ACCEPT', theirReceiveMode: 'AUTO_ACCEPT', defaultReminders: [-60, -1440] },
  { id: 'p-dad', displayName: '아버지', relation: 'FAMILY', status: 'CONNECTED', receiveMode: 'ASK', theirReceiveMode: 'ASK', defaultReminders: [-60] },
  { id: 'p-minsu', displayName: '민수', relation: 'FRIEND', status: 'CONNECTED', receiveMode: 'ASK', theirReceiveMode: 'ASK', defaultReminders: [-30] },
  { id: 'p-jieun', displayName: '지은', relation: 'FRIEND', status: 'CONNECTED', receiveMode: 'AUTO_REJECT', theirReceiveMode: 'AUTO_REJECT', defaultReminders: [-30] },
];
const mockFriendRequests = [{ id: 'fr-1', displayName: '박준호' }];
const mockScheduleRequests = [{ id: 'sr-1', fromId: 'p-minsu', title: '저녁 약속', startAt: atTime(dayStart(3), 19, 0), offsets: [-60] }];
const basePeople = mockPeople.map(person => ({ ...person }));
const MY_CODE = 'VLM-7K4Q-92XD';
const KNOWN_CODES = { 'VLM-3M8R-41ZP': '이서연' }; // 목업: 서버가 없어서 이 코드만 "찾아진다"
const mockSettings = { remindersOn: true, ownDefaultOffset: -30 };
let peopleNotice = '';

const connectedPeople = () => mockPeople.filter(person => person.status === 'CONNECTED');
const personById = id => mockPeople.find(person => person.id === id);
const initialOf = name => Array.from(name)[0] ?? '?';

// ---------- 작은 부품 ----------
function makeButton(className, textClass, label, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.append(textElement('span', textClass, label));
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function makeDiv(className, ...children) {
  const element = document.createElement('div');
  element.className = className;
  element.append(...children);
  return element;
}

function makeAvatar(name) {
  return makeDiv('avatar', textElement('p', 'avatarText', initialOf(name)));
}

// 알약 한 줄: values 중 selected 에 든 것이 눌린 모양. multi 이면 여러 개, 아니면 하나만.
function buildPills(containerId, values, labelOf, selected, onToggle) {
  byId(containerId).replaceChildren(...values.map(value => {
    const button = makeButton('pill', 'pillText', labelOf(value), () => onToggle(value));
    setActive(button, selected.includes(value), 'pillActive', 'pillTextActive');
    return button;
  }));
}

// ---------- 화면 전환 (앱에서는 Expo Router 의 화면 이동) ----------
const PAGES = {
  home: { id: 'homeScreen', title: 'Voice Life Manager' },
  settings: { id: 'settingsPage', title: '설정' },
  plan: { id: 'planPage', title: '요금제' },
  people: { id: 'peoplePage', title: '가족·친구' },
};
let currentPage = 'home';
const pageStack = [];

function showPage(name) {
  currentPage = name;
  Object.entries(PAGES).forEach(([key, page]) => show(page.id, key === name));
  byId('headerTitle').textContent = PAGES[name].title;
  show('backButton', name !== 'home');
  show('settingsOpen', name === 'home');
  highlight('[data-page]', button => button.dataset.page === name);
  window.scrollTo(0, 0);
}

function openPage(name) {
  stopScenario();
  closeLayers();
  showSheet('settings', false);
  if (name === currentPage) return;
  pageStack.push(currentPage);
  showPage(name);
}

function goBack() {
  closeLayers();
  showPage(pageStack.pop() ?? 'home');
}

// 디자인 확인용 버튼: 어느 화면이든 바로 이동 (뒤로 가면 홈)
function jumpToPage(name) {
  stopScenario();
  closeLayers();
  showSheet('settings', false);
  pageStack.length = 0;
  if (name !== 'home') pageStack.push('home');
  showPage(name);
}

// ---------- 시트 ----------
const layerIds = ['addSheet', 'inviteSheet', 'personSheet', 'sendSheet'];

function closeLayers() {
  layerIds.forEach(id => show(id, false));
  show('layerBackdrop', false);
}

function openLayer(id) {
  closeLayers();
  show('layerBackdrop', true);
  show(id, true);
}

// ---------- 요금제 카드 ----------
function buildPlanCard(planKey) {
  const info = PLAN_INFO[planKey];
  const current = account.plan === planKey;
  const head = makeDiv('rowBetween', textElement('h2', 'planName', info.name));
  if (current) head.append(makeDiv('tag', textElement('p', 'tagText', '이용 중')));
  const features = makeDiv('featureList');
  PLAN_FEATURES[planKey].forEach(([kind, label]) => {
    const off = kind === 'off';
    features.append(makeDiv('featureLine', textElement('p', off ? 'featureMark featureOff' : 'featureMark', off ? '—' : '✓'), textElement('p', off ? 'featureText featureOff' : 'featureText', label)));
  });
  const card = makeDiv(current ? 'planCard planCardCurrent' : 'planCard', head, textElement('p', 'planPrice', info.price), features);

  if (!current && planKey === 'FREE') {
    card.append(textElement('p', 'muted', '구독을 끝내면 무료로 돌아가요.'));
  } else if (!current) {
    const label = account.plan === 'FREE' ? (planKey === 'MONTHLY' ? '월 구독 시작' : '무제한 시작') : planKey === 'UNLIMITED' ? '무제한으로 변경' : '월 구독으로 변경';
    card.append(makeButton('button', 'buttonText', label, () => setAccount(PLAN_KEY[planKey])));
  }
  return card;
}

// ---------- 가족·친구 ----------
function buildRequestButtons(specs) {
  return makeDiv('buttonRow', ...specs.map(([label, primary, onClick]) => makeButton(primary ? 'smallButton' : 'smallSecondary', primary ? 'smallButtonText' : 'smallSecondaryText', label, onClick)));
}

function acceptScheduleRequest(request, newMode) {
  const person = personById(request.fromId);
  if (newMode) person.receiveMode = newMode;
  mockEvents.push(makeEventAt(newId(3000), request.title, request.startAt, 60, null));
  mockScheduleRequests.splice(mockScheduleRequests.indexOf(request), 1);
  peopleNotice = `캘린더에 넣었어요: ${request.title}.${newMode ? ` 앞으로 ${person.displayName}의 일정은 항상 수락해요.` : ''}`;
  renderAccountViews();
  renderCalendar();
}

function rejectScheduleRequest(request, newMode) {
  const person = personById(request.fromId);
  if (newMode) person.receiveMode = newMode;
  mockScheduleRequests.splice(mockScheduleRequests.indexOf(request), 1);
  peopleNotice = `거부했어요: ${request.title} (${person.displayName}).${newMode ? ` 앞으로 ${person.displayName}의 일정은 항상 거부해요.` : ''}`;
  renderAccountViews();
}

function buildScheduleRequestCard(request) {
  const person = personById(request.fromId);
  const when = request.startAt;
  const line = `${dayLabel(when)} ${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
  return makeDiv('requestCard',
    textElement('p', 'eyebrow', `받은 일정 · 보낸 사람 ${person.displayName}`),
    textElement('p', 'heading', request.title),
    textElement('p', 'text', line),
    textElement('p', 'muted', `알림: ${reminderListLabel(request.offsets)}`),
    buildRequestButtons([
      ['이번만 수락', true, () => acceptScheduleRequest(request, null)],
      ['이번만 거부', false, () => rejectScheduleRequest(request, null)],
      ['항상 수락', true, () => acceptScheduleRequest(request, 'AUTO_ACCEPT')],
      ['항상 거부', false, () => rejectScheduleRequest(request, 'AUTO_REJECT')],
    ]));
}

function buildFriendRequestCard(request) {
  return makeDiv('requestCard',
    textElement('p', 'eyebrow', '받은 친구 요청'),
    textElement('p', 'heading', `${request.displayName}님이 친구가 되고 싶어 해요`),
    buildRequestButtons([
      ['수락', true, () => {
        mockFriendRequests.splice(mockFriendRequests.indexOf(request), 1);
        mockPeople.push({ id: newId(4000), displayName: request.displayName, relation: 'FRIEND', status: 'CONNECTED', receiveMode: 'ASK', theirReceiveMode: 'ASK', defaultReminders: [-30] });
        peopleNotice = `${request.displayName}님과 연결됐어요.`;
        renderAccountViews();
      }],
      ['거절', false, () => { mockFriendRequests.splice(mockFriendRequests.indexOf(request), 1); peopleNotice = ''; renderAccountViews(); }],
    ]));
}

function personHint(person) {
  return `${RELATION_LABEL[person.relation]} · 받은 일정 ${RECEIVE_MODES[person.receiveMode].label} · 보낼 때 알림 ${reminderListLabel(person.defaultReminders)}`;
}

function buildPersonRow(person, last) {
  const lastClass = last ? ' personRowLast' : '';
  if (person.status === 'REQUEST_SENT') {
    const cancel = makeButton('linkButton', 'linkText', '취소', () => { mockPeople.splice(mockPeople.indexOf(person), 1); renderAccountViews(); });
    return makeDiv(`personRow personRowStatic${lastClass}`, makeAvatar(person.displayName),
      makeDiv('personMain', makeDiv('personTop', textElement('p', 'personName', person.displayName), makeDiv('tag', textElement('p', 'tagText', '요청 보냄'))), textElement('p', 'settingHint', '상대가 수락하면 연결돼요.')),
      cancel);
  }
  const row = makeDiv(`personRow${lastClass}`, makeAvatar(person.displayName),
    makeDiv('personMain', makeDiv('personTop', textElement('p', 'personName', person.displayName)), textElement('p', 'settingHint', personHint(person))),
    textElement('p', 'chevron', '›'));
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', `${person.displayName} 설정`);
  row.addEventListener('click', () => openPersonSheet(person.id));
  return row;
}

function renderPeoplePage() {
  const locked = !isPaid();
  show('peopleLocked', locked);
  show('peopleBody', !locked);
  if (locked) return;
  const cards = [];
  if (peopleNotice) cards.push(makeDiv('notice', textElement('p', 'noticeText', peopleNotice)));
  mockFriendRequests.forEach(request => cards.push(buildFriendRequestCard(request)));
  mockScheduleRequests.forEach(request => cards.push(buildScheduleRequestCard(request)));
  byId('incomingBox').replaceChildren(...cards);
  const list = mockPeople.length
    ? mockPeople.map((person, index) => buildPersonRow(person, index === mockPeople.length - 1))
    : [textElement('p', 'agendaEmpty', '아직 연결된 사람이 없어요. 위의 "친구·가족 추가"로 시작해 보세요.')];
  byId('peopleList').replaceChildren(...list);
}

// ---------- 사람 설정 시트 ----------
let personEditingId = null;
let removeArmed = null; // 'remove' | 'block': 한 번 눌러 확인을 받은 상태

function renderPersonSheet() {
  const person = personById(personEditingId);
  if (!person) return;
  byId('personTitle').textContent = person.displayName;
  if (byId('personName').value !== person.displayName) byId('personName').value = person.displayName;
  document.querySelectorAll('[data-relation]').forEach(button => setActive(button, button.dataset.relation === person.relation, 'segmentButtonActive', 'segmentTextActive'));
  document.querySelectorAll('[data-receive]').forEach(button => setActive(button, button.dataset.receive === person.receiveMode, 'segmentButtonActive', 'segmentTextActive'));
  byId('receiveHint').textContent = RECEIVE_MODES[person.receiveMode].hint;
  buildPills('personReminders', REMINDER_OFFSETS, reminderLabel, person.defaultReminders, value => {
    const has = person.defaultReminders.includes(value);
    person.defaultReminders = has ? person.defaultReminders.filter(item => item !== value) : [...person.defaultReminders, value];
    renderPersonSheet();
    renderPeoplePage();
  });
  byId('personRemoveText').textContent = removeArmed === 'remove' ? '정말 끊을까요? 한 번 더 누르세요' : '연결 끊기';
  byId('personBlockText').textContent = removeArmed === 'block' ? '정말 차단할까요? 한 번 더 누르세요' : '차단';
}

function openPersonSheet(id) {
  personEditingId = id;
  removeArmed = null;
  renderPersonSheet();
  openLayer('personSheet');
}

function removePerson(kind) {
  if (removeArmed !== kind) {
    removeArmed = kind;
    renderPersonSheet();
    return;
  }
  const person = personById(personEditingId);
  mockPeople.splice(mockPeople.indexOf(person), 1);
  peopleNotice = kind === 'block' ? `차단했어요: ${person.displayName}` : `연결을 끊었어요: ${person.displayName}`;
  closeLayers();
  renderAccountViews();
}

// ---------- 추가 시트 ----------
let addTab = 'share';
let foundCode = null;

function setAddTab(tab) {
  addTab = tab;
  show('addShare', tab === 'share');
  show('addEnter', tab === 'enter');
  document.querySelectorAll('[data-addtab]').forEach(button => setActive(button, button.dataset.addtab === tab, 'segmentButtonActive', 'segmentTextActive'));
}

function openAddSheet(tab) {
  byId('copyCodeText').textContent = '코드 복사';
  show('shareLinkNote', false);
  byId('codeInput').value = '';
  show('codeError', false);
  show('codeFound', false);
  foundCode = null;
  setAddTab(tab);
  openLayer('addSheet');
}

function findCode() {
  const code = byId('codeInput').value.trim().toUpperCase();
  const error = !/^VLM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) ? '코드는 VLM-XXXX-XXXX 모양이에요. 다시 확인해 주세요.'
    : code === MY_CODE ? '내 코드예요. 상대의 코드를 넣어 주세요.'
    : !KNOWN_CODES[code] ? '이 코드를 가진 사람을 찾지 못했어요.' : '';
  show('codeError', false);
  show('codeFound', false);
  if (error) {
    byId('codeError').textContent = error;
    show('codeError', true);
    return;
  }
  foundCode = code;
  byId('foundName').textContent = KNOWN_CODES[code];
  byId('foundInitial').textContent = initialOf(KNOWN_CODES[code]);
  byId('foundCode').textContent = code;
  byId('codeSendText').textContent = '친구 요청 보내기';
  setDisabled('codeSend', false);
  show('codeFound', true);
}

function sendFriendRequest() {
  if (!foundCode || mockPeople.some(person => person.displayName === KNOWN_CODES[foundCode])) return;
  mockPeople.push({ id: newId(4100), displayName: KNOWN_CODES[foundCode], relation: 'FRIEND', status: 'REQUEST_SENT', receiveMode: 'ASK', theirReceiveMode: 'ASK', defaultReminders: [-30] });
  byId('codeSendText').textContent = '요청을 보냈어요. 상대가 수락하면 연결돼요.';
  setDisabled('codeSend', true);
  renderAccountViews();
}

// ---------- 링크로 열었을 때 ----------
function openInviteSheet() {
  byId('inviteName').textContent = '이서연님';
  byId('inviteInitial').textContent = '이';
  openLayer('inviteSheet');
}

function acceptInvite() {
  if (!mockPeople.some(person => person.displayName === '이서연')) {
    mockPeople.push({ id: newId(4200), displayName: '이서연', relation: 'FRIEND', status: 'CONNECTED', receiveMode: 'ASK', theirReceiveMode: 'ASK', defaultReminders: [-30] });
  }
  peopleNotice = '이서연님과 연결됐어요.';
  closeLayers();
  renderAccountViews();
}

// ---------- 일정 보내기 시트 ----------
const sendState = { recipients: [], offsets: [], touched: false };

function syncSendOffsets() {
  if (sendState.touched) return;
  const set = new Set();
  sendState.recipients.forEach(id => personById(id).defaultReminders.forEach(value => set.add(value)));
  sendState.offsets = [...set];
}

function renderSendForm() {
  buildPills('sendPeople', connectedPeople().map(person => person.id), id => personById(id).displayName, sendState.recipients, id => {
    sendState.recipients = sendState.recipients.includes(id) ? sendState.recipients.filter(item => item !== id) : [...sendState.recipients, id];
    syncSendOffsets();
    renderSendForm();
  });
  buildPills('sendReminders', REMINDER_OFFSETS, reminderLabel, sendState.offsets, value => {
    sendState.touched = true;
    sendState.offsets = sendState.offsets.includes(value) ? sendState.offsets.filter(item => item !== value) : [...sendState.offsets, value];
    renderSendForm();
  });
}

function openSendSheet(personId) {
  sendState.recipients = personId ? [personId] : [];
  sendState.touched = false;
  syncSendOffsets();
  byId('sendTitle').value = '';
  byId('sendDate').value = dateKey(focusDate);
  byId('sendTime').value = '10:00';
  show('sendError', false);
  show('sendForm', true);
  show('sendResult', false);
  renderSendForm();
  openLayer('sendSheet');
}

function sendOutcome(person, offsets) {
  if (person.theirReceiveMode === 'AUTO_ACCEPT') return `캘린더에 바로 들어갔어요 · 알림 ${reminderListLabel(offsets)}`;
  if (person.theirReceiveMode === 'ASK') return '수락을 기다리고 있어요';
  return '거절됨';
}

function submitSend() {
  const title = byId('sendTitle').value.trim();
  const date = parseDateKey(byId('sendDate').value);
  const clock = parseClock(byId('sendTime').value);
  const error = !sendState.recipients.length ? '받는 사람을 골라 주세요' : !title ? '제목을 적어 주세요' : !date ? '날짜를 2026-10-02 처럼 적어 주세요' : !clock ? '시간을 15:00 처럼 적어 주세요' : '';
  show('sendError', false);
  if (error) {
    byId('sendError').textContent = error;
    show('sendError', true);
    return;
  }
  byId('sendResultList').replaceChildren(...sendState.recipients.map(id => {
    const person = personById(id);
    return makeDiv('resultRow', makeAvatar(person.displayName), makeDiv('resultMain', textElement('p', 'personName', person.displayName), textElement('p', 'settingHint', sendOutcome(person, sendState.offsets))));
  }));
  show('sendForm', false);
  show('sendResult', true);
}

// ---------- 계정 상태를 모든 화면에 반영 ----------
function setAccount(key) {
  accountKey = key;
  account = { ...ACCOUNT_PRESETS[key] };
  renderAccountViews();
}

function renderAccountViews() {
  const usage = usageView();

  // 홈: 남은 횟수 한 줄
  const remaining = aiRemaining();
  const unlimited = account.aiLimit === null;
  show('usageBox', !unlimited);
  byId('usageLine').textContent = remaining > 0 ? `AI 해석 ${remaining}회 남음` : 'AI 해석 횟수를 모두 썼어요. 간단한 문장 해석과 직접 입력은 계속 쓸 수 있어요.';
  show('usageLink', account.plan === 'FREE' || remaining === 0);

  // 홈: 일정 보내기 링크는 구독 전용 기능이라 무료에서는 잠긴 표시
  byId('sendButton').firstElementChild.textContent = isPaid() ? '일정 보내기' : '일정 보내기 (구독)';

  // 설정: 상단 횟수 카드
  byId('usageLabel').textContent = usage.label;
  byId('usageNumber').textContent = usage.number;
  byId('usageUnit').textContent = usage.unit;
  byId('usageCaption').textContent = usage.caption;
  show('usageMeter', usage.meter);
  byId('meterFill').style.flexGrow = String(usage.ratio * 100);
  byId('meterRest').style.flexGrow = String((1 - usage.ratio) * 100);
  byId('planValue').textContent = PLAN_INFO[account.plan].name;
  const waiting = mockFriendRequests.length + mockScheduleRequests.length;
  byId('peopleValue').textContent = isPaid() ? `${connectedPeople().length}명${waiting ? ` · 요청 ${waiting}건` : ''}` : '구독 전용';

  // 설정: 알림
  byId('remindToggle').classList.toggle('toggleOn', mockSettings.remindersOn);
  byId('rowRemind').setAttribute('aria-checked', String(mockSettings.remindersOn));
  byId('ownReminderBlock').classList.toggle('disabled', !mockSettings.remindersOn);
  buildPills('ownReminderPills', REMINDER_OFFSETS, reminderLabel, [mockSettings.ownDefaultOffset], value => {
    if (!mockSettings.remindersOn) return;
    mockSettings.ownDefaultOffset = value;
    renderAccountViews();
  });

  // 요금제, 가족·친구
  byId('planList').replaceChildren(...['FREE', 'MONTHLY', 'UNLIMITED'].map(buildPlanCard));
  renderPeoplePage();

  highlight('[data-account]', button => button.dataset.account === accountKey);
}

// 디자인 확인용 시트 버튼: 구독 기능이라 무료이면 구독 상태로 바꿔서 보여 준다
function openDesignLayer(name) {
  if (!isPaid()) setAccount('monthly');
  if (name === 'invite') openInviteSheet();
  else if (name === 'add') openAddSheet('share');
  else if (name === 'person') openPersonSheet(mockPeople[0].id);
  else openSendSheet(mockPeople[0].id);
}

// 시나리오의 "처음으로"가 일정을 되돌릴 때 사람·요청도 처음 모습으로
const restoreTransactionsBase = restoreTransactions;
restoreTransactions = function restoreTransactionsAndPeople() {
  restoreTransactionsBase();
  mockPeople.splice(0, mockPeople.length, ...basePeople.map(person => ({ ...person })));
  peopleNotice = '';
};

// ---------- 이벤트 연결 ----------
function loadView() {
  try {
    const saved = localStorage.getItem('calendarView');
    return VIEWS.includes(saved) ? saved : 'week';
  } catch {
    return 'week';
  }
}

document.querySelectorAll('[data-state]').forEach(button => {
  button.addEventListener('click', () => render(button.dataset.state));
});
document.querySelectorAll('[data-motion]').forEach(button => {
  button.addEventListener('click', () => { reducedMotion = !reducedMotion; applyMotion(); });
});
document.querySelectorAll('[data-size]').forEach(button => {
  button.addEventListener('click', () => applyFontScale(Number(button.dataset.size), true));
});
document.querySelectorAll('[data-scenario]').forEach(button => {
  button.addEventListener('click', () => {
    if (button.dataset.scenario === 'reset') {
      restoreTransactions();
      render('default');
    } else {
      runScenario(button.dataset.scenario).catch(error => console.error(error));
    }
  });
});
document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => changeView(button.dataset.view));
});
document.querySelectorAll('[data-type]').forEach(button => {
  button.addEventListener('click', () => { if (editing && editing.mode === 'new') applyEditType(button.dataset.type); });
});
byId('designToggle').addEventListener('click', () => setBarOpen(byId('designPanel').hidden));
byId('designTop').addEventListener('click', () => window.scrollTo(0, 0));
// 캘린더: 이전/다음, 오늘로, 추가
byId('calPrev').addEventListener('click', () => shiftCalendar(-1));
byId('calNext').addEventListener('click', () => shiftCalendar(1));
byId('todayButton').addEventListener('click', () => pickDate(dayStart(0)));
byId('addButton').addEventListener('click', openNew);
// 시트: 화면 설정 / 일정 편집
byId('settingsOpen').addEventListener('click', () => openPage('settings'));
byId('backButton').addEventListener('click', goBack);
byId('settingsClose').addEventListener('click', () => showSheet('settings', false));
byId('settingsBackdrop').addEventListener('click', () => showSheet('settings', false));
byId('colorReset').addEventListener('click', () => applyColors(DEFAULT_COLORS, true));
byId('editClose').addEventListener('click', closeEdit);
byId('editBackdrop').addEventListener('click', closeEdit);
byId('editSave').addEventListener('click', saveEdit);
byId('editDelete').addEventListener('click', deleteEdit);
// 앱 동작 재현: 버튼을 누르면 녹음을 멈추고 오버레이가 사라져 홈이 보인다.
byId('overlayButton').addEventListener('click', () => render('default'));
byId('bubbleYes').addEventListener('click', () => answer('yes'));
byId('bubbleNo').addEventListener('click', () => answer('no'));
window.addEventListener('scroll', onPageScroll);
window.addEventListener('resize', () => {
  fitOverlay();
  settlePet();
});

// 새 화면 연결: 설정 · 요금제 · 가족·친구 · 시트
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => jumpToPage(button.dataset.page)));
document.querySelectorAll('[data-account]').forEach(button => button.addEventListener('click', () => setAccount(button.dataset.account)));
document.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => openDesignLayer(button.dataset.layer)));
document.querySelectorAll('[data-close-layer]').forEach(button => button.addEventListener('click', closeLayers));
document.querySelectorAll('[data-addtab]').forEach(button => button.addEventListener('click', () => setAddTab(button.dataset.addtab)));
document.querySelectorAll('[data-relation]').forEach(button => button.addEventListener('click', () => { personById(personEditingId).relation = button.dataset.relation; renderPersonSheet(); renderPeoplePage(); }));
document.querySelectorAll('[data-receive]').forEach(button => button.addEventListener('click', () => { personById(personEditingId).receiveMode = button.dataset.receive; renderPersonSheet(); renderPeoplePage(); }));
byId('layerBackdrop').addEventListener('click', closeLayers);
byId('usageLink').addEventListener('click', () => openPage('plan'));
byId('usagePlanLink').addEventListener('click', () => openPage('plan'));
byId('rowPlan').addEventListener('click', () => openPage('plan'));
byId('rowPeople').addEventListener('click', () => openPage('people'));
byId('rowDisplay').addEventListener('click', () => showSheet('settings', true));
byId('rowRemind').addEventListener('click', () => { mockSettings.remindersOn = !mockSettings.remindersOn; renderAccountViews(); });
byId('peopleToPlan').addEventListener('click', () => openPage('plan'));
byId('addPersonOpen').addEventListener('click', () => openAddSheet('share'));
byId('sendButton').addEventListener('click', () => (isPaid() ? openSendSheet(null) : openPage('plan')));
byId('copyCode').addEventListener('click', () => {
  try { navigator.clipboard.writeText(MY_CODE); } catch { /* 미리보기에서 복사가 막혀도 모양만 확인하면 된다 */ }
  byId('copyCodeText').textContent = '복사했어요';
});
byId('shareLink').addEventListener('click', () => show('shareLinkNote', true));
byId('codeFind').addEventListener('click', findCode);
byId('codeInput').addEventListener('keydown', event => { if (event.key === 'Enter') findCode(); });
byId('codeSend').addEventListener('click', sendFriendRequest);
byId('inviteAccept').addEventListener('click', acceptInvite);
byId('personName').addEventListener('input', () => {
  const person = personById(personEditingId);
  const name = byId('personName').value.trim();
  if (!person || !name) return;
  person.displayName = name;
  byId('personTitle').textContent = name;
  renderPeoplePage();
});
byId('personSend').addEventListener('click', () => openSendSheet(personEditingId));
byId('personRemove').addEventListener('click', () => removePerson('remove'));
byId('personBlock').addEventListener('click', () => removePerson('block'));
byId('sendGo').addEventListener('click', submitSend);

calView = loadView();
buildSwatchRow('accentSwatches', 'accent', '포인트 색', ACCENT_PRESETS);
buildSwatchRow('baseSwatches', 'base', '바탕색', BASE_PRESETS);
applyColors(loadColors(), false);
applyFontScale(loadFontScale(), false);
render('default');
renderAccountViews();
showPage('home');
applyMotion();
setBarOpen(false);
// 이 컴퓨터가 '동작 줄이기'를 켜 두면 움직임이 멈춰 보이므로 이유를 알려 준다 (디자인 확인용)
show('motionNote', Boolean(motionQuery && motionQuery.matches));
