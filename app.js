const STORAGE = 'chapter-quiz:v1';
const courseIds = ['fudan', 'xmu'];
const courseLabels = { fudan: '复旦 · 人工智能，语言与伦理', xmu: '厦大 · 大数据与人工智能导论' };
const modeNames = { ordered: '顺序刷题', random: '随机刷题', wrong: '错题练习' };
const typeNames = { single: '单选题', multiple: '多选题', boolean: '判断题', short: '简答题' };

const screen = document.querySelector('#screen');
const importFile = document.querySelector('#import-file');
const courses = {};
let state;
let view = 'home';
let notice = '';
let storageError = false;

function element(tag, className = '', content = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

function group(tag, className, ...children) {
  const node = element(tag, className);
  node.append(...children);
  return node;
}

function button(label, action, style = 'secondary') {
  const node = element('button', style, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function freshState() {
  return {
    version: 1,
    course: courseIds[0],
    courses: Object.fromEntries(courseIds.map(id => [id, { wrong: [], rounds: {}, last: null }]))
  };
}

function normalizeState(raw) {
  if (raw?.version !== 1 || !courseIds.includes(raw.course)) {
    throw new Error('无法识别备份版本');
  }

  const clean = freshState();
  clean.course = raw.course;
  for (const id of courseIds) {
    const incoming = raw.courses?.[id];
    const record = clean.courses[id];
    const { byId } = courses[id];
    if (!Array.isArray(incoming?.wrong) || !incoming.rounds || typeof incoming.rounds !== 'object') {
      throw new Error('备份中的课程记录不完整');
    }
    record.wrong = [...new Set(incoming.wrong
      .filter(number => byId.has(number))
      .map(number => byId.get(number).duplicateOf ?? number))];

    for (const mode of Object.keys(modeNames)) {
      const round = incoming.rounds[mode];
      if (!round) continue;
      if (!Array.isArray(round.ids) || !Number.isInteger(round.index) ||
          round.index < 0 || round.index > round.ids.length || !Array.isArray(round.selected)) {
        throw new Error('备份中的练习进度有误');
      }

      const allowed = number => byId.has(number) &&
        (mode !== 'wrong' || record.wrong.includes(number));
      const prefix = new Set(round.ids.slice(0, round.index).filter(allowed));
      const ids = [...new Set(round.ids.filter(allowed))];
      if (!ids.length) continue;

      const index = prefix.size;
      const sameQuestion = ids[index] !== undefined && ids[index] === round.ids[round.index];
      const labels = sameQuestion ? byId.get(ids[index]).options.map(o => o.id) : [];
      record.rounds[mode] = {
        ids, index,
        selected: [...new Set(round.selected.filter(value => labels.includes(value)))],
        revealed: sameQuestion && round.revealed === true,
        selfResult: sameQuestion && typeof round.selfResult === 'boolean' ? round.selfResult : null
      };
    }
    if (Object.keys(modeNames).includes(incoming.last) && record.rounds[incoming.last]) {
      record.last = incoming.last;
    }
  }
  return clean;
}

function save() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(state));
    storageError = false;
  } catch {
    storageError = true;
  }
}

const course = () => courses[state.course];
const record = () => state.courses[state.course];
const round = () => record().rounds[record().last];
const selfCheck = question => question.type === 'short' || Boolean(question.review);
const questionKey = question => question.duplicateOf ?? question.id;

function navigate(nextView) {
  view = nextView;
  notice = '';
  render();
  window.scrollTo(0, 0);
  document.querySelector('h1')?.focus({ preventScroll: true });
}

function heading(text) {
  const node = element('h1', '', text);
  node.tabIndex = -1;
  return node;
}

function shuffled(ids) {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function start(mode, reset = false) {
  const current = record();
  const saved = current.rounds[mode];
  if (reset || !saved || saved.index >= saved.ids.length) {
    let ids = course().questions.map(question => question.id);
    if (mode === 'random') {
      ids = shuffled(course().questions.filter(question => !question.duplicateOf).map(question => question.id));
    }
    if (mode === 'wrong') ids = [...current.wrong];
    if (!ids.length) return navigate('wrong');
    current.rounds[mode] = { ids, index: 0, selected: [], revealed: false, selfResult: null };
  }
  current.last = mode;
  save();
  navigate('practice');
}

function renderHome() {
  const picker = element('select');
  picker.id = 'course-select';
  for (const id of courseIds) {
    const item = element('option', '', courseLabels[id]);
    item.value = id;
    picker.append(item);
  }
  picker.value = state.course;
  picker.addEventListener('change', () => {
    state.course = picker.value;
    save();
    render();
    document.querySelector('#course-select').focus();
  });

  const label = element('label', 'muted', '选择课程');
  label.htmlFor = picker.id;
  const stats = group('div', 'row stats',
    group('span', '', element('strong', '', course().questions.length), ' 道题'),
    group('span', '', element('strong', '', record().wrong.length), ' 道错题'));

  const actions = group('section', 'card stack',
    heading('开始刷题'),
    button('顺序刷题', () => start('ordered'), 'primary full'),
    button('随机刷题', () => start('random'), 'secondary full'),
    button('错题本', () => navigate('wrong'), 'secondary full'));
  const pending = round();
  if (pending && pending.index < pending.ids.length) {
    const description = modeNames[record().last] + ' · ' + (pending.index + 1) + '/' + pending.ids.length;
    actions.insertBefore(button('继续上次 · ' + description, () => navigate('practice'), 'secondary full'), actions.children[1]);
  }

  const backups = group('div', 'row',
    button('导出记录', exportRecords),
    button('导入记录', () => importFile.click()));
  return group('div', 'stack', group('section', 'card stack', group('div', '', label, picker), stats), actions, backups);
}

function matches(question, selected) {
  return selected.length === question.answer.length && selected.every(id => question.answer.includes(id));
}

function rememberWrong(question) {
  const id = questionKey(question);
  if (!record().wrong.includes(id)) record().wrong.push(id);
}

function submit(question) {
  const active = round();
  active.revealed = true;
  if (!selfCheck(question) && !matches(question, active.selected)) rememberWrong(question);
  save();
  render();
  document.querySelector('#feedback')?.focus({ preventScroll: true });
}

function answerText(question) {
  if (question.type === 'short') return question.answer ?? '资料未给出答案';
  if (!question.answer) return '资料未给出答案';
  return question.answer.map(id => {
    const option = question.options.find(item => item.id === id);
    return question.type === 'boolean' ? option.text : id + '．' + option.text;
  }).join('；');
}

function renderOptions(question, active) {
  const buttons = question.options.map(option => {
    const picked = active.selected.includes(option.id);
    let style = picked ? 'option selected' : 'option';
    if (active.revealed && !selfCheck(question)) {
      if (question.answer.includes(option.id)) style = 'option correct';
      else if (picked) style = 'option incorrect';
    }
    const node = button('', () => {
      if (question.type === 'multiple') {
        active.selected = picked ? active.selected.filter(id => id !== option.id) : [...active.selected, option.id];
        save();
        render();
        document.getElementById(node.id)?.focus({ preventScroll: true });
      } else {
        active.selected = [option.id];
        submit(question);
      }
    }, style);
    node.id = 'opt-' + option.id;
    node.disabled = active.revealed || selfCheck(question);
    if (question.type === 'multiple') node.setAttribute('aria-pressed', String(picked));
    if (question.type !== 'boolean') {
      const label = option.id === question.source.missingOptionLabel ? '·' : option.id;
      node.append(element('span', 'option-id', label));
    }
    node.append(element('span', '', option.text));
    return node;
  });
  return group('div', 'stacked', ...buttons);
}

function next() {
  const active = round();
  active.index++;
  active.selected = [];
  active.revealed = false;
  active.selfResult = null;
  save();
  navigate('practice');
}

function renderPractice() {
  const mode = record().last;
  const active = round();
  const back = button(mode === 'wrong' ? '返回错题本' : '返回首页', () => navigate(mode === 'wrong' ? 'wrong' : 'home'));
  if (!active || active.index >= active.ids.length) {
    return group('div', 'stack', back,
      group('section', 'card stack',
        heading('本轮完成'),
        element('p', 'muted', '已完成 ' + (active?.ids.length ?? 0) + ' 道题'),
        button('再练一轮', () => start(mode, true), 'primary full')));
  }

  const question = course().byId.get(active.ids[active.index]);
  const title = heading(question.prompt);
  title.className = 'prompt';
  const position = (active.index + 1) + ' / ' + active.ids.length;
  const bar = element('progress', 'progress');
  bar.max = active.ids.length;
  bar.value = active.index + 1;
  bar.setAttribute('aria-label', '练习进度');
  const content = group('article', 'card stack',
    element('p', 'metadata', typeNames[question.type] + ' · 题库 #' + question.id),
    title);
  if (question.review) content.append(element('p', 'feedback review', question.review));
  if (question.options.length) content.append(renderOptions(question, active));

  if (!active.revealed) {
    if (selfCheck(question)) content.append(button('查看参考答案', () => submit(question), 'primary full'));
    else if (question.type === 'multiple') {
      const confirm = button('提交答案', () => submit(question), 'primary full');
      confirm.disabled = active.selected.length === 0;
      content.append(confirm);
    }
  } else {
    const manual = selfCheck(question);
    const correct = manual ? active.selfResult : matches(question, active.selected);
    const result = correct === null ? '参考答案' : correct ? '回答正确' : '回答错误';
    const style = correct === null ? 'feedback' : correct ? 'feedback correct' : 'feedback incorrect';
    const feedback = group('div', style, element('strong', '', result),
      element('p', '', (manual ? '' : '正确答案 · ') + answerText(question)));
    feedback.id = 'feedback';
    feedback.tabIndex = -1;
    feedback.setAttribute('role', 'status');
    content.append(feedback);
    if (manual && correct === null) {
      function assess(value) {
        active.selfResult = value;
        if (!value) rememberWrong(question);
        save();
        render();
        document.querySelector('#feedback')?.focus({ preventScroll: true });
      }
      content.append(group('div', 'row',
        button('答对了', () => assess(true)), button('记为错题', () => assess(false))));
    } else {
      const label = active.index + 1 === active.ids.length ? '完成本轮' : '下一题';
      content.append(button(label, next, 'primary full'));
    }
  }

  return group('div', 'stack',
    group('div', 'row between', back, element('span', 'metadata', modeNames[mode] + ' · ' + position)),
    bar, content);
}

function removeWrong(id) {
  const current = record();
  current.wrong = current.wrong.filter(number => number !== id);
  const active = current.rounds.wrong;
  if (active && active.ids.includes(id)) {
    const removed = active.ids.indexOf(id);
    active.ids.splice(removed, 1);
    if (removed < active.index) active.index--;
    if (removed === active.index) {
      active.selected = [];
      active.revealed = false;
      active.selfResult = null;
    }
  }
  save();
  render();
}

function renderWrong() {
  const count = record().wrong.length;
  const header = group('div', 'row between', heading('错题本'), element('span', 'metadata', count + ' 道'));
  const items = course().questions.filter(q => record().wrong.includes(q.id)).map(question =>
    group('li', 'card wrong-item',
      element('p', 'metadata', '题库 #' + question.id + ' · ' + typeNames[question.type]),
      element('h2', '', question.prompt),
      button('移出错题本', () => removeWrong(question.id))));
  const controls = button('练习错题', () => start('wrong'), 'primary full');
  controls.disabled = count === 0;
  return group('section', 'stack',
    group('div', 'row', button('返回首页', () => navigate('home'))),
    group('div', 'card stack', header, count ? controls : element('p', 'muted', '当前课程还没有错题。')),
    group('ul', 'stack wrong-list', ...items));
}

function render() {
  const content = view === 'home' ? renderHome() : view === 'wrong' ? renderWrong() : renderPractice();
  const banners = [];
  if (storageError) banners.push(element('p', 'notice feedback review', '浏览器无法保存记录。离开前可回首页导出备份。'));
  if (notice) {
    const status = element('p', 'notice feedback', notice);
    status.setAttribute('role', 'status');
    banners.push(status);
  }
  screen.replaceChildren(...banners, content);
  screen.removeAttribute('aria-busy');
}

function exportRecords() {
  const data = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = element('a');
  link.href = URL.createObjectURL(data);
  link.download = '章节刷题记录-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1000);
}

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('文件过大');
    const imported = normalizeState(JSON.parse(await file.text()));
    if (!window.confirm('导入将替换两门课程在此浏览器中的练习进度和错题。继续导入？')) return;
    state = imported;
    save();
    notice = '已导入刷题记录。';
  } catch {
    notice = '导入失败。请选择从章节刷题导出的 JSON 记录。';
  }
  render();
});

async function init() {
  try {
    await Promise.all(courseIds.map(async id => {
      const response = await fetch('./data/' + id + '.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('题库加载失败');
      const bank = await response.json();
      courses[id] = { ...bank, byId: new Map(bank.questions.map(q => [q.id, q])) };
    }));
  } catch {
    screen.replaceChildren(group('section', 'card stack', heading('题库加载失败'),
      element('p', 'muted', '请通过网页地址打开，或检查网络后重试。'),
      button('重新加载', () => location.reload(), 'primary full')));
    screen.removeAttribute('aria-busy');
    return;
  }

  state = freshState();
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      try {
        state = normalizeState(JSON.parse(raw));
      } catch {
        notice = '浏览器中的旧记录无法读取。可从备份恢复。';
      }
    }
  } catch {
    storageError = true;
  }
  render();
}

init();
