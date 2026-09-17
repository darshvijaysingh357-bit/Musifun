const state = {
  prompt: '',
  genre: 'Lo-fi',
  durationSeconds: 60,
  engine: 'lyria',
  customerEmail: '',
  continent: 'North America',
  reviewRating: 0,
  lastTrack: null // { audioUrl, mimeType, modelUsed }
};

let appConfig = { genres: [], continents: [], engines: [], razorpayKeyId: null, upiId: null };

// ---------------- navigation ----------------
function goView(name) {
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${name}`));
  document.querySelectorAll('nav.tabs button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === name));
  if (name === 'payment') refreshQuote();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => goView(btn.dataset.view));
});

// ---------------- init ----------------
async function init() {
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();
  } catch (e) {
    console.error('Could not load config', e);
    appConfig = { genres: ['Lo-fi','EDM','Hip-Hop','Cinematic','Ambient','Trap','Pop','Rock','Jazz'], continents: ['North America','Europe','Oceania','South America','Asia','Africa'], engines: ['lyria','assistant'], razorpayKeyId: null, upiId: null };
  }

  renderContinentList();
  renderGenreList();
  renderStarPicker();
  updateDuration();
  updateCharCount();

  if (!appConfig.razorpayKeyId || !window.Razorpay) {
    document.getElementById('stripeWarning').style.display = 'block';
    document.getElementById('payButton').disabled = true;
  }
}

// ---------------- create tab ----------------
function renderContinentList() {
  const list = document.getElementById('continentList');
  list.innerHTML = '';
  appConfig.continents.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'genre-opt' + (c === state.continent ? ' selected' : '');
    el.textContent = c;
    el.onclick = () => {
      state.continent = c;
      document.querySelectorAll('#continentList .genre-opt').forEach((n) => n.classList.remove('selected'));
      el.classList.add('selected');
    };
    list.appendChild(el);
  });
}

function renderGenreList() {
  const list = document.getElementById('genreList');
  list.innerHTML = '';
  appConfig.genres.forEach((g) => {
    const el = document.createElement('div');
    el.className = 'genre-opt' + (g === state.genre ? ' selected' : '');
    el.textContent = g;
    el.onclick = () => {
      state.genre = g;
      document.querySelectorAll('#genreList .genre-opt').forEach((n) => n.classList.remove('selected'));
      el.classList.add('selected');
    };
    list.appendChild(el);
  });
}

document.getElementById('promptInput').addEventListener('input', updateCharCount);
function updateCharCount() {
  const val = document.getElementById('promptInput').value;
  state.prompt = val;
  document.getElementById('charCount').textContent = val.length;
}

document.getElementById('durationSlider').addEventListener('input', updateDuration);
function updateDuration() {
  const v = parseInt(document.getElementById('durationSlider').value, 10);
  state.durationSeconds = v;
  const m = Math.floor(v / 60);
  const s = v % 60;
  document.getElementById('durationLabel').textContent = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${v}s`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------- generation ----------------
function resetGeneratePanels() {
  document.getElementById('genWaiting').style.display = 'none';
  document.getElementById('genLoading').style.display = 'none';
  document.getElementById('genError').style.display = 'none';
  document.getElementById('genDone').style.display = 'none';
  document.getElementById('assistantForm').style.display = 'none';
  document.getElementById('assistantSent').style.display = 'none';
  document.getElementById('chatbotBox').style.display = 'none';
}

async function startGeneration(engine) {
  state.engine = engine;
  goView('generate');
  resetGeneratePanels();

  document.getElementById('generateHeading').textContent =
    engine === 'lyria' ? 'A few quick questions — Lyria 3' : 'A few quick questions — Your Assistant';

  // Run the specification chatbot first, for either engine. Its confirm
  // step calls proceedAfterChatbot() once the customer accepts the
  // assembled prompt.
  document.getElementById('chatbotBox').style.display = 'block';
  resetChatbot();
}

async function proceedAfterChatbot(engine) {
  document.getElementById('chatbotBox').style.display = 'none';
  document.getElementById('generateHeading').textContent =
    engine === 'lyria' ? 'Generating with Lyria 3' : 'Request to Your Assistant';

  if (engine === 'assistant') {
    document.getElementById('reqPrompt').textContent = state.prompt.trim() || 'No prompt set';
    document.getElementById('reqGenre').textContent = state.genre;
    document.getElementById('reqDuration').textContent = formatDuration(state.durationSeconds);
    document.getElementById('assistantForm').style.display = 'block';
    return;
  }

  // Lyria 3: real generation call
  document.getElementById('genLoading').style.display = 'block';
  const statusEl = document.getElementById('genStatusText');
  const messages = ['Reading your prompt…', 'Composing with Lyria 3…', 'Rendering audio…'];
  let i = 0;
  statusEl.textContent = messages[0];
  const cycle = setInterval(() => {
    i = (i + 1) % messages.length;
    statusEl.textContent = messages[i];
  }, 1800);

  try {
    const res = await fetch('/api/generate/lyria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: state.prompt,
        genre: state.genre,
        durationSeconds: state.durationSeconds
      })
    });
    const data = await res.json();
    clearInterval(cycle);
    document.getElementById('genLoading').style.display = 'none';

    if (!res.ok) {
      throw new Error(data.error || 'Generation failed.');
    }

    const audioUrl = `data:${data.mimeType};base64,${data.audioBase64}`;
    state.lastTrack = { audioUrl, mimeType: data.mimeType, modelUsed: data.modelUsed };

    document.getElementById('trackTitle').textContent = state.prompt.trim()
      ? (state.prompt.length > 48 ? state.prompt.slice(0, 48) + '…' : state.prompt)
      : `${state.genre} track`;
    document.getElementById('trackMeta').textContent = `${state.genre} · ${formatDuration(state.durationSeconds)} · ${data.modelUsed}`;
    document.getElementById('trackAudio').src = audioUrl;
    document.getElementById('genDone').style.display = 'block';
  } catch (err) {
    clearInterval(cycle);
    document.getElementById('genLoading').style.display = 'none';
    const errEl = document.getElementById('genError');
    errEl.textContent = err.message || 'Something went wrong while generating.';
    errEl.style.display = 'block';
  }
}

async function sendAssistantRequest() {
  const emailInput = document.getElementById('assistantEmail');
  const email = emailInput.value.trim();
  const errEl = document.getElementById('assistantError');
  errEl.style.display = 'none';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Enter a valid email address.';
    errEl.style.display = 'block';
    emailInput.focus();
    return;
  }

  state.customerEmail = email;

  try {
    const res = await fetch('/api/assistant/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: state.prompt,
        genre: state.genre,
        durationSeconds: state.durationSeconds,
        customerEmail: email,
        continent: state.continent
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not send the request.');

    document.getElementById('assistantForm').style.display = 'none';
    document.getElementById('assistantSentNote').textContent =
      `We'll send your finished track to ${email} once it's ready.`;
    document.getElementById('assistantSent').style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

// ---------------- payment ----------------
async function refreshQuote() {
  document.getElementById('sumPrompt').textContent = state.prompt.trim()
    ? (state.prompt.length > 30 ? state.prompt.slice(0, 30) + '…' : state.prompt)
    : 'No prompt set';
  document.getElementById('sumGenre').textContent = state.genre;
  document.getElementById('sumDuration').textContent = formatDuration(state.durationSeconds);
  document.getElementById('sumEngine').textContent = state.engine === 'lyria' ? 'Lyria 3' : 'Your Assistant';

  try {
    const res = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre: state.genre, durationSeconds: state.durationSeconds, engine: state.engine, continent: state.continent })
    });
    const quote = await res.json();
    if (!res.ok) throw new Error(quote.error);
    document.getElementById('sumTotalUSD').textContent = `$${quote.usd.toFixed(2)}`;
    document.getElementById('sumTotalINR').textContent = `₹${quote.inr}`;
    document.getElementById('payButton').textContent = `Pay ₹${quote.inr}`;

    if (appConfig.upiId) {
      document.getElementById('upiSection').style.display = 'block';
      document.getElementById('upiIdText').textContent = appConfig.upiId;
      document.getElementById('upiAmountText').textContent = `₹${quote.inr}`;
    }
  } catch (err) {
    console.error('Quote error', err);
  }
}

function copyUpiId() {
  if (!appConfig.upiId) return;
  navigator.clipboard.writeText(appConfig.upiId).then(() => {
    const btn = event.target;
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => {});
}

async function claimUpiPayment() {
  const errEl = document.getElementById('upiError');
  errEl.style.display = 'none';
  const btn = document.getElementById('upiClaimButton');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const res = await fetch('/api/payments/upi-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: state.prompt,
        genre: state.genre,
        durationSeconds: state.durationSeconds,
        engine: state.engine,
        continent: state.continent,
        customerEmail: state.customerEmail
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not record your payment.');

    document.getElementById('paymentForm').style.display = 'none';
    document.getElementById('upiSection').style.display = 'none';
    document.getElementById('paySuccessNote').textContent =
      "Thanks! We'll verify your payment and " +
      (state.engine === 'assistant'
        ? `send your finished track to ${state.customerEmail || 'your email'} once it's ready.`
        : 'your track will be ready in the Generate tab shortly.');
    document.getElementById('paySuccess').style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function submitPayment() {
  if (!appConfig.razorpayKeyId || !window.Razorpay) return;
  const payButton = document.getElementById('payButton');
  const originalLabel = payButton.textContent;
  payButton.disabled = true;
  payButton.textContent = 'Preparing…';
  document.getElementById('card-errors').textContent = '';

  try {
    const orderRes = await fetch('/api/payments/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre: state.genre, durationSeconds: state.durationSeconds, engine: state.engine, continent: state.continent })
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok) throw new Error(orderData.error || 'Could not start payment.');

    const options = {
      key: appConfig.razorpayKeyId,
      amount: orderData.amount,
      currency: 'INR',
      name: 'MusiFun',
      description: `${state.genre} · ${formatDuration(state.durationSeconds)} · ${state.engine === 'lyria' ? 'Lyria 3' : 'Your Assistant'}`,
      order_id: orderData.orderId,
      theme: { color: '#b8934c' },
      handler: async function (response) {
        try {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response)
          });
          const verifyData = await verifyRes.json();
          if (!verifyRes.ok || !verifyData.verified) throw new Error('Payment could not be verified.');

          document.getElementById('paymentForm').style.display = 'none';
          document.getElementById('paySuccessNote').textContent =
            state.engine === 'assistant'
              ? `Your assistant is on it — the finished track will arrive at ${state.customerEmail || 'your email'}.`
              : 'Your track is ready in the Generate tab.';
          document.getElementById('paySuccess').style.display = 'block';
        } catch (err) {
          document.getElementById('card-errors').textContent = err.message;
          payButton.disabled = false;
          payButton.textContent = originalLabel;
        }
      },
      modal: {
        ondismiss: function () {
          payButton.disabled = false;
          payButton.textContent = originalLabel;
        }
      }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response) {
      document.getElementById('card-errors').textContent = response.error && response.error.description
        ? response.error.description
        : 'Payment failed.';
      payButton.disabled = false;
      payButton.textContent = originalLabel;
    });
    rzp.open();
    payButton.textContent = originalLabel;
    payButton.disabled = false;
  } catch (err) {
    document.getElementById('card-errors').textContent = err.message;
    payButton.disabled = false;
    payButton.textContent = originalLabel;
  }
}

// ---------------- review ----------------
function renderStarPicker() {
  const stars = document.querySelectorAll('#starPicker .star');
  stars.forEach((star) => {
    star.addEventListener('click', () => {
      state.reviewRating = parseInt(star.dataset.value, 10);
      stars.forEach((s) => {
        s.classList.toggle('filled', parseInt(s.dataset.value, 10) <= state.reviewRating);
      });
    });
  });
}

async function submitReview() {
  const errEl = document.getElementById('reviewError');
  errEl.style.display = 'none';

  if (!state.reviewRating) {
    errEl.textContent = 'Tap a star to rate the track first.';
    errEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: state.reviewRating,
        comment: document.getElementById('reviewComment').value,
        genre: state.genre,
        durationSeconds: state.durationSeconds,
        engine: state.engine
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not send your review.');

    document.getElementById('reviewSection').style.display = 'none';
    document.getElementById('reviewThanks').style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

init();
 
