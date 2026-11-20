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
      const legacy = round.attempts === undefined;
      if (!Array.isArray(round.ids) || !Number.isInteger(round.index) ||
          round.index < 0 || round.index > round.ids.length ||
          (legacy ? !Array.isArray(round.selected) : !round.attempts || typeof round.attempts !== 'object')) {
        throw new Error('备份中的练习进度有误');
      }

      const allowed = number => byId.has(number) &&
        (mode !== 'wrong' || record.wrong.includes(number));
      const prefix = new Set(round.ids.slice(0, round.index).filter(allowed));
      const ids = [...new Set(round.ids.filter(allowed))];
      if (!ids.length) continue;

      const index = prefix.size;
      const attempts = {};
      for (const number of ids) {
        if (legacy && prefix.has(number)) {
          attempts[number] = { legacy: true };
          continue;
        }
        const entry = legacy ? (number === round.ids[round.index] ? round : null) : round.attempts[number];
        if (entry?.legacy === true) {
          attempts[number] = { legacy: true };
        } else if (Array.isArray(entry?.selected)) {
          const labels = byId.get(number).options.map(option => option.id);
          attempts[number] = {
            selected: [...new Set(entry.selected.filter(value => labels.includes(value)))],
            revealed: entry.revealed === true,
            selfResult: typeof entry.selfResult === 'boolean' ? entry.selfResult : null
          };
        }
      }
      record.rounds[mode] = { ids, index, attempts };
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
const emptyAttempt = () => ({ selected: [], revealed: false, selfResult: null });

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
    current.rounds[mode] = { ids, index: 0, attempts: {} };
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
  } else if (pending?.ids.length) {
    actions.append(button('查看上轮答题卡', () => navigate('practice'), 'secondary full'));
  }

  const backups = group('div', 'row',
    button('导出记录', exportRecords),
    button('导入记录', () => importFile.click()));
  return group('div', 'stack', group('section', 'card stack', group('div', '', label, picker), stats), actions, backups);
}

function matches(question, selected) {
  return selected.length === question.answer.length && selected.every(id => question.answer.includes(id));
}

function resultFor(question, attempt) {
  if (!attempt?.revealed) return null;
  return selfCheck(question) ? attempt.selfResult : matches(question, attempt.selected);
}

function statusFor(id, active) {
  const attempt = active.attempts[id];
  if (attempt?.legacy) return 'legacy';
  const result = resultFor(course().byId.get(id), attempt);
  return result === null ? 'unanswered' : result ? 'correct' : 'incorrect';
}

function rememberWrong(question) {
  const id = questionKey(question);
  if (!record().wrong.includes(id)) record().wrong.push(id);
}

function submit(question, attempt) {
  attempt.revealed = true;
  round().attempts[question.id] = attempt;
  if (resultFor(question, attempt) === false) rememberWrong(question);
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

function renderOptions(question, attempt) {
  const buttons = question.options.map(option => {
    const picked = attempt.selected.includes(option.id);
    let style = picked ? 'option selected' : 'option';
    if (attempt.revealed && !selfCheck(question)) {
      if (question.answer.includes(option.id)) style = 'option correct';
      else if (picked) style = 'option incorrect';
    }
    const node = button('', () => {
      if (question.type === 'multiple') {
        attempt.selected = picked ? attempt.selected.filter(id => id !== option.id) : [...attempt.selected, option.id];
        round().attempts[question.id] = attempt;
        save();
        render();
        document.getElementById(node.id)?.focus({ preventScroll: true });
      } else {
        attempt.selected = [option.id];
        submit(question, attempt);
      }
    }, style);
    node.id = 'opt-' + option.id;
    node.disabled = attempt.revealed || selfCheck(question);
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

function jumpTo(index) {
  round().index = index;
  save();
  navigate('practice');
}

function renderAnswerCard(active, statuses) {
  const statusLabels = { unanswered: '未答', correct: '答对', incorrect: '答错', legacy: '旧记录' };
  const title = element('h2', '', '答题卡');
  title.id = 'answer-card-title';
  title.tabIndex = -1;
  const legend = group('div', 'row metadata',
    ...Object.entries(statusLabels).filter(([status]) => status !== 'legacy' || statuses.includes(status))
      .map(([status, label]) => group('span', 'answer-key',
        element('span', 'answer-swatch ' + status), label)));
  const cellsByType = Object.fromEntries(Object.keys(typeNames).map(type => [type, []]));
  active.ids.forEach((id, index) => {
    const { type } = course().byId.get(id);
    const status = statuses[index];
    const position = index + 1;
    const cell = button(position, () => jumpTo(index), 'answer-number ' + status);
    cell.setAttribute('aria-label', '第 ' + position + ' 题，' + statusLabels[status]);
    if (index === active.index) cell.setAttribute('aria-current', 'true');
    cellsByType[type].push(cell);
  });
  const shortcuts = group('div', 'row answer-shortcuts');
  const sections = group('div', 'answer-sections stacked');
  for (const [type, cells] of Object.entries(cellsByType)) {
    if (!cells.length) continue;
    const label = element('h3', 'answer-type', typeNames[type]);
    label.id = 'answer-type-' + type;
    label.tabIndex = -1;
    const section = group('section', 'stacked', label, group('div', 'answer-grid', ...cells));
    section.setAttribute('aria-labelledby', label.id);
    sections.append(section);
    const shortcut = button(typeNames[type], () => {
      sections.scrollTop = label.offsetTop;
      label.focus({ preventScroll: true });
    }, 'secondary answer-shortcut');
    shortcut.setAttribute('aria-controls', label.id);
    shortcuts.append(shortcut);
  }
  const card = group('section', 'card stack',
    title, legend, element('p', 'muted', '点击题号可跳转'), shortcuts, sections);
  card.setAttribute('aria-labelledby', title.id);
  return card;
}

function renderPractice() {
  const mode = record().last;
  const active = round();
  const back = button(mode === 'wrong' ? '返回错题本' : '返回首页', () => navigate(mode === 'wrong' ? 'wrong' : 'home'));
  const statuses = active?.ids.map(id => statusFor(id, active)) ?? [];
  const answerCard = statuses.length ? renderAnswerCard(active, statuses) : null;
  if (!active || active.index >= active.ids.length) {
    return group('div', 'stack', back,
      group('section', 'card stack',
        heading('本轮完成'),
        element('p', 'muted', '已完成 ' + statuses.filter(status => status !== 'unanswered').length + ' 道题'),
        button('再练一轮', () => start(mode, true), 'primary full')),
      ...(answerCard ? [answerCard] : []));
  }

  const question = course().byId.get(active.ids[active.index]);
  const savedAttempt = active.attempts[question.id];
  const attempt = savedAttempt?.selected ? savedAttempt : emptyAttempt();
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
  if (question.options.length) content.append(renderOptions(question, attempt));

  const firstUnanswered = statuses.indexOf('unanswered');
  const atEnd = active.index === active.ids.length - 1;
  const nextButton = () => {
    if (firstUnanswered === -1) return button('完成本轮', () => jumpTo(active.ids.length), 'primary full');
    if (!atEnd) return button('下一题', () => jumpTo(active.index + 1), 'primary full');
    return button('去做未答题', () => jumpTo(firstUnanswered), 'primary full');
  };

  if (!attempt.revealed) {
    if (selfCheck(question)) content.append(button('查看参考答案', () => submit(question, attempt), 'primary full'));
    else if (question.type === 'multiple') {
      const confirm = button('提交答案', () => submit(question, attempt), 'primary full');
      confirm.disabled = attempt.selected.length === 0;
      content.append(confirm);
    }
    if (savedAttempt?.legacy) {
      content.append(element('p', 'muted', '旧进度已保存，这道题没有可恢复的作答结果。'), nextButton());
    }
  } else {
    const manual = selfCheck(question);
    const correct = resultFor(question, attempt);
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
        attempt.selfResult = value;
        if (!value) rememberWrong(question);
        save();
        render();
        document.querySelector('#feedback')?.focus({ preventScroll: true });
      }
      content.append(group('div', 'row',
        button('答对了', () => assess(true)), button('记为错题', () => assess(false))));
    } else {
      content.append(group('div', 'practice-actions',
        button('重新作答', () => {
          delete active.attempts[question.id];
          jumpTo(active.index);
        }), nextButton()));
    }
  }

  const showCard = button('答题卡', () => {
    const title = document.querySelector('#answer-card-title');
    title.focus({ preventScroll: true });
    title.scrollIntoView({ block: 'start' });
  });
  return group('div', 'stack',
    group('div', 'row between', back, element('span', 'metadata', modeNames[mode] + ' · ' + position), showCard),
    bar, content, answerCard);
}

function removeWrong(id) {
  const current = record();
  current.wrong = current.wrong.filter(number => number !== id);
  const active = current.rounds.wrong;
  if (active && active.ids.includes(id)) {
    const removed = active.ids.indexOf(id);
    active.ids.splice(removed, 1);
    if (removed < active.index) active.index--;
    delete active.attempts[id];
    if (active.index >= active.ids.length) {
      const pending = active.ids.findIndex(number => statusFor(number, active) === 'unanswered');
      if (pending !== -1) active.index = pending;
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
  const currentCell = screen.querySelector('.answer-number[aria-current]');
  if (currentCell) {
    const sections = currentCell.closest('.answer-sections');
    sections.scrollTop = currentCell.offsetTop - sections.clientHeight / 2 + currentCell.offsetHeight / 2;
  }
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
