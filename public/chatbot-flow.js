// Rule-based specification chatbot: walks the customer through Purpose,
// Mood, Reference, genre-specific Instrumentation, and Avoid — then
// assembles everything into one clean structured prompt for state.prompt.
// No AI call involved; entirely deterministic and free to run.

const chatbotState = {
  step: 0,           // 0=purpose, 1=mood, 2=reference, 3=instrumentation, 4=avoid, 5=confirm
  purpose: '',
  moods: [],
  reference: '',
  instrumentAnswers: [],
  avoid: ''
};

const PURPOSE_OPTIONS = ['Background / ambience', 'A hook or intro', 'Full song with vocals', 'Something else'];
const MOOD_OPTIONS = ['Chill / relaxed', 'Energetic / upbeat', 'Dark / intense', 'Emotional / sentimental', 'Playful / quirky'];

function resetChatbot() {
  chatbotState.step = 0;
  chatbotState.purpose = '';
  chatbotState.moods = [];
  chatbotState.reference = '';
  chatbotState.instrumentAnswers = [];
  chatbotState.avoid = '';
  renderChatbotStep();
}

function chatbotGenreQuestions() {
  return (typeof GENRE_QUESTIONS !== 'undefined' && GENRE_QUESTIONS[state.genre])
    ? GENRE_QUESTIONS[state.genre]
    : [];
}

function renderChatbotStep() {
  const box = document.getElementById('chatbotBox');
  if (!box) return;
  box.innerHTML = '';

  if (chatbotState.step === 0) {
    box.appendChild(buildSingleChoiceStep(
      "What's this track for?",
      PURPOSE_OPTIONS,
      chatbotState.purpose,
      (val) => { chatbotState.purpose = val; chatbotState.step = 1; renderChatbotStep(); }
    ));
  } else if (chatbotState.step === 1) {
    box.appendChild(buildMultiChoiceStep(
      'How should it feel? (pick 1–2)',
      MOOD_OPTIONS,
      chatbotState.moods,
      2,
      () => { chatbotState.step = 2; renderChatbotStep(); }
    ));
  } else if (chatbotState.step === 2) {
    box.appendChild(buildTextStep(
      'Any artist, song, or existing track this should feel similar to?',
      'Optional — e.g. "something like Tycho" or "moody like a Hans Zimmer score"',
      chatbotState.reference,
      (val) => { chatbotState.reference = val; chatbotState.step = 3; renderChatbotStep(); }
    ));
  } else if (chatbotState.step === 3) {
    const questions = chatbotGenreQuestions();
    if (!questions.length) {
      chatbotState.step = 4;
      renderChatbotStep();
      return;
    }
    box.appendChild(buildInstrumentationStep(questions));
  } else if (chatbotState.step === 4) {
    box.appendChild(buildTextStep(
      "Anything you specifically don't want?",
      'Optional — e.g. "no distorted vocals" or "avoid heavy bass"',
      chatbotState.avoid,
      (val) => { chatbotState.avoid = val; chatbotState.step = 5; renderChatbotStep(); }
    ));
  } else if (chatbotState.step === 5) {
    box.appendChild(buildConfirmStep());
  }
}

function buildSingleChoiceStep(question, options, current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'chatbot-step';
  const q = document.createElement('div');
  q.className = 'chatbot-question';
  q.textContent = question;
  wrap.appendChild(q);

  const list = document.createElement('div');
  list.className = 'genre-list';
  options.forEach((opt) => {
    const el = document.createElement('div');
    el.className = 'genre-opt' + (opt === current ? ' selected' : '');
    el.textContent = opt;
    el.onclick = () => onPick(opt);
    list.appendChild(el);
  });
  wrap.appendChild(list);
  return wrap;
}

function buildMultiChoiceStep(question, options, selectedArr, maxPick, onDone) {
  const wrap = document.createElement('div');
  wrap.className = 'chatbot-step';
  const q = document.createElement('div');
  q.className = 'chatbot-question';
  q.textContent = question;
  wrap.appendChild(q);

  const list = document.createElement('div');
  list.className = 'genre-list';
  options.forEach((opt) => {
    const el = document.createElement('div');
    el.className = 'genre-opt' + (selectedArr.includes(opt) ? ' selected' : '');
    el.textContent = opt;
    el.onclick = () => {
      const idx = selectedArr.indexOf(opt);
      if (idx > -1) {
        selectedArr.splice(idx, 1);
      } else if (selectedArr.length < maxPick) {
        selectedArr.push(opt);
      }
      renderChatbotStep();
    };
    list.appendChild(el);
  });
  wrap.appendChild(list);

  const next = document.createElement('button');
  next.className = 'cta block';
  next.style.marginTop = '18px';
  next.textContent = 'Continue';
  next.disabled = selectedArr.length === 0;
  next.onclick = onDone;
  wrap.appendChild(next);
  return wrap;
}

function buildTextStep(question, placeholder, current, onNext) {
  const wrap = document.createElement('div');
  wrap.className = 'chatbot-step';
  const q = document.createElement('div');
  q.className = 'chatbot-question';
  q.textContent = question;
  wrap.appendChild(q);

  const input = document.createElement('textarea');
  input.placeholder = placeholder;
  input.value = current;
  input.maxLength = 200;
  wrap.appendChild(input);

  const next = document.createElement('button');
  next.className = 'cta block';
  next.style.marginTop = '14px';
  next.textContent = 'Continue';
  next.onclick = () => onNext(input.value.trim());
  wrap.appendChild(next);
  return wrap;
}

function buildInstrumentationStep(questions) {
  const wrap = document.createElement('div');
  wrap.className = 'chatbot-step';
  const q = document.createElement('div');
  q.className = 'chatbot-question';
  q.textContent = `A few things specific to ${state.genre}:`;
  wrap.appendChild(q);

  const inputs = [];
  questions.forEach((question, i) => {
    const label = document.createElement('div');
    label.className = 'chatbot-subquestion';
    label.textContent = question;
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Optional';
    input.value = chatbotState.instrumentAnswers[i] || '';
    wrap.appendChild(input);
    inputs.push(input);
  });

  const next = document.createElement('button');
  next.className = 'cta block';
  next.style.marginTop = '18px';
  next.textContent = 'Continue';
  next.onclick = () => {
    chatbotState.instrumentAnswers = inputs.map((inp) => inp.value.trim());
    chatbotState.step = 4;
    renderChatbotStep();
  };
  wrap.appendChild(next);
  return wrap;
}

function assembleStructuredPrompt() {
  const parts = [];
  if (chatbotState.purpose) parts.push(`Purpose: ${chatbotState.purpose}.`);
  if (chatbotState.moods.length) parts.push(`Mood: ${chatbotState.moods.join(', ')}.`);
  if (chatbotState.reference) parts.push(`Reference feel: ${chatbotState.reference}.`);

  const questions = chatbotGenreQuestions();
  const instrumentBits = chatbotState.instrumentAnswers
    .map((ans, i) => (ans ? `${questions[i]} → ${ans}` : null))
    .filter(Boolean);
  if (instrumentBits.length) parts.push(`Details: ${instrumentBits.join(' ')}`);

  if (chatbotState.avoid) parts.push(`Avoid: ${chatbotState.avoid}.`);

  return parts.join(' ');
}

function buildConfirmStep() {
  const wrap = document.createElement('div');
  wrap.className = 'chatbot-step';
  const q = document.createElement('div');
  q.className = 'chatbot-question';
  q.textContent = "Here's what we'll use — edit anything before continuing:";
  wrap.appendChild(q);

  const textarea = document.createElement('textarea');
  textarea.id = 'chatbotFinalPrompt';
  textarea.maxLength = 240;
  textarea.value = assembleStructuredPrompt();
  textarea.style.minHeight = '120px';
  wrap.appendChild(textarea);

  const startOver = document.createElement('button');
  startOver.className = 'cta ghost block';
  startOver.style.marginTop = '14px';
  startOver.textContent = 'Start over';
  startOver.onclick = resetChatbot;
  wrap.appendChild(startOver);

  const confirm = document.createElement('button');
  confirm.className = 'cta block';
  confirm.style.marginTop = '10px';
  confirm.textContent = 'Use this and continue';
  confirm.onclick = () => {
    const finalPrompt = document.getElementById('chatbotFinalPrompt').value;
    state.prompt = finalPrompt;
    proceedAfterChatbot(state.engine);
  };
  wrap.appendChild(confirm);
  return wrap;
}
