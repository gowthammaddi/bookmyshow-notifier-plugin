// Popup script for managing monitored movies

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup loaded');

  // Clear old format movies first
  await clearOldMovies();

  // Load data
  await loadMovies();
  await updateMonitoringStatus();
  await loadCheckInterval();
  await loadTeamsSettings();
  await loadSoundSettings();
  checkAlertStatus();

  setTimeout(() => {
    checkPendingNotification();
  }, 100);

  // Add event listeners
  const addMovieBtn = document.getElementById('addMovie');
  if (addMovieBtn) addMovieBtn.addEventListener('click', addMovie);

  const toggleBtn = document.getElementById('toggleMonitoring');
  if (toggleBtn) toggleBtn.addEventListener('click', toggleMonitoring);

  const checkNowBtn = document.getElementById('checkNow');
  if (checkNowBtn) checkNowBtn.addEventListener('click', checkNow);

  const intervalInput = document.getElementById('checkInterval');
  if (intervalInput) intervalInput.addEventListener('change', saveCheckInterval);

  const teamsCheckbox = document.getElementById('enableTeamsCall');
  if (teamsCheckbox) teamsCheckbox.addEventListener('change', saveTeamsSettings);

  const teamsEmail = document.getElementById('teamsEmail');
  if (teamsEmail) teamsEmail.addEventListener('blur', saveTeamsSettings);

  const soundCheckbox = document.getElementById('enableSound');
  if (soundCheckbox) soundCheckbox.addEventListener('change', saveSoundSettings);

  const stopBtn = document.getElementById('stopAlert');
  if (stopBtn) stopBtn.addEventListener('click', stopAlert);

  const parseUrlBtn = document.getElementById('parseUrl');
  if (parseUrlBtn) parseUrlBtn.addEventListener('click', parseUrl);
});

async function clearOldMovies() {
  try {
    const data = await chrome.storage.local.get(['movies']);
    const movies = data.movies || [];
    const hasOld = movies.some(m => m.apiUrl);

    if (hasOld) {
      await chrome.storage.local.set({ movies: [] });
      console.log('Cleared old format movies');
    }
  } catch (e) {
    console.error('Clear error:', e);
  }
}

async function loadMovies() {
  const data = await chrome.storage.local.get(['movies']);
  const movies = data.movies || [];

  const container = document.getElementById('movieListContainer');
  if (!container) return;

  if (movies.length === 0) {
    container.innerHTML = '<div class="empty-state">No movies added yet</div>';
    return;
  }

  container.innerHTML = movies.map((movie, index) => {
    const dateText = movie.targetDate ? ' - ' + formatDate(movie.targetDate) : ' (Any Date)';
    const statusText = movie.lastStatus === 'available' ? '✅ Tickets Available!' :
                      movie.lastStatus === 'date-mismatch' ? '⏳ Not available for target date yet' :
                      movie.lastStatus === 'error' ? '❌ Error' : '⏳ Not Available Yet';
    const checkedText = movie.lastChecked ? '• ' + new Date(movie.lastChecked).toLocaleTimeString() : '';

    return `
      <div class="movie-item">
        <div class="movie-info">
          <div class="movie-title">${escapeHtml(movie.title)}${dateText}</div>
          <div class="movie-status">${statusText} ${checkedText}</div>
        </div>
        <button class="btn-remove" data-index="${index}">Remove</button>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      removeMovie(idx);
    });
  });
}

async function addMovie() {
  try {
    const title = document.getElementById('movieTitle')?.value?.trim() || '';
    const movieId = document.getElementById('movieId')?.value?.trim() || '';
    const city = document.getElementById('movieCity')?.value?.trim().toLowerCase() || '';
    const targetDate = document.getElementById('targetDate')?.value?.trim() || '';

    if (!title || !movieId || !city) {
      alert('Please enter movie title, ID, and city');
      return;
    }

    if (targetDate && !/^\d{8}$/.test(targetDate)) {
      alert('Invalid date format. Use YYYYMMDD (e.g., 20260109)');
      return;
    }

    const movieSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const data = await chrome.storage.local.get(['movies']);
    const movies = data.movies || [];

    movies.push({
      id: Date.now().toString(),
      title,
      movieId,
      city,
      movieSlug,
      targetDate: targetDate || null,
      added: new Date().toISOString(),
      lastChecked: null,
      lastStatus: null
    });

    await chrome.storage.local.set({ movies });

    document.getElementById('movieTitle').value = '';
    document.getElementById('movieId').value = '';
    document.getElementById('movieCity').value = '';
    const dateInput = document.getElementById('targetDate');
    if (dateInput) dateInput.value = '';

    await loadMovies();
  } catch (error) {
    console.error('Error adding movie:', error);
    alert('Error adding movie. Check console for details.');
  }
}

async function removeMovie(index) {
  const data = await chrome.storage.local.get(['movies', 'lastNotification']);
  const movies = data.movies || [];
  const removed = movies[index];

  movies.splice(index, 1);
  await chrome.storage.local.set({ movies });

  if (data.lastNotification?.movieId === removed?.id) {
    await chrome.storage.local.remove(['lastNotification']);
    chrome.action.setBadgeText({ text: '' });
  }

  await loadMovies();
}

async function toggleMonitoring() {
  const data = await chrome.storage.local.get(['isMonitoring']);
  const isMonitoring = data.isMonitoring || false;

  if (isMonitoring) {
    await chrome.storage.local.set({ isMonitoring: false });
    chrome.runtime.sendMessage({ action: 'stopMonitoring' });
  } else {
    const interval = parseInt(document.getElementById('checkInterval')?.value) || 5;
    await chrome.storage.local.set({ isMonitoring: true, checkInterval: interval });
    chrome.runtime.sendMessage({ action: 'startMonitoring', interval });
  }

  await updateMonitoringStatus();
}

async function loadCheckInterval() {
  const data = await chrome.storage.local.get(['checkInterval']);
  const input = document.getElementById('checkInterval');
  if (input) input.value = data.checkInterval || 5;
}

async function saveCheckInterval() {
  const input = document.getElementById('checkInterval');
  if (!input) return;

  const interval = parseInt(input.value) || 5;

  if (interval < 1 || interval > 60) {
    alert('Please enter a value between 1 and 60 minutes');
    input.value = 5;
    return;
  }

  await chrome.storage.local.set({ checkInterval: interval });
  await updateMonitoringStatus();

  const data = await chrome.storage.local.get(['isMonitoring']);
  if (data.isMonitoring) {
    chrome.runtime.sendMessage({ action: 'stopMonitoring' });
    chrome.runtime.sendMessage({ action: 'startMonitoring', interval });
  }
}

async function updateMonitoringStatus() {
  const data = await chrome.storage.local.get(['isMonitoring', 'checkInterval']);
  const isMonitoring = data.isMonitoring || false;
  const interval = data.checkInterval || 5;

  const dot = document.getElementById('statusIndicator');
  const text = document.getElementById('monitoringStatus');
  const btn = document.getElementById('toggleMonitoring');

  if (!dot || !text || !btn) return;

  if (isMonitoring) {
    dot.className = 'status-indicator status-active';
    text.textContent = `Monitoring Active (checks every ${interval} min)`;
    btn.textContent = 'Stop Monitoring';
  } else {
    dot.className = 'status-indicator status-inactive';
    text.textContent = 'Monitoring Inactive';
    btn.textContent = 'Start Monitoring';
  }
}

async function checkNow() {
  const btn = document.getElementById('checkNow');
  if (!btn) return;

  const original = btn.textContent;
  btn.textContent = 'Checking...';
  btn.disabled = true;

  console.log('Check Now clicked');

  chrome.runtime.sendMessage({ action: 'checkNow' }, (response) => {
    console.log('Response:', response);
    btn.textContent = original;
    btn.disabled = false;
    setTimeout(() => {
      loadMovies();
      checkAlertStatus();
    }, 1000);
  });
}

async function loadTeamsSettings() {
  const data = await chrome.storage.local.get(['enableTeamsCall', 'teamsEmail']);
  const checkbox = document.getElementById('enableTeamsCall');
  const email = document.getElementById('teamsEmail');

  if (checkbox) checkbox.checked = data.enableTeamsCall || false;
  if (email) {
    email.value = data.teamsEmail || '';
    email.disabled = !data.enableTeamsCall;
  }
}

async function saveTeamsSettings() {
  const checkbox = document.getElementById('enableTeamsCall');
  const email = document.getElementById('teamsEmail');

  if (!checkbox || !email) return;

  const enabled = checkbox.checked;
  const emailVal = email.value.trim();

  email.disabled = !enabled;

  await chrome.storage.local.set({
    enableTeamsCall: enabled,
    teamsEmail: emailVal
  });
}

async function loadSoundSettings() {
  const data = await chrome.storage.local.get(['enableSound']);
  const checkbox = document.getElementById('enableSound');
  if (checkbox) checkbox.checked = data.enableSound !== false;
}

async function saveSoundSettings() {
  const checkbox = document.getElementById('enableSound');
  if (!checkbox) return;
  await chrome.storage.local.set({ enableSound: checkbox.checked });
}

async function checkPendingNotification() {
  const data = await chrome.storage.local.get(['lastNotification', 'movies']);

  if (!data.lastNotification) return;

  const notif = data.lastNotification;
  const movies = data.movies || [];
  const exists = movies.some(m => m.id === notif.movieId);

  if (!exists) {
    await chrome.storage.local.remove(['lastNotification']);
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const timeAgo = Math.floor((Date.now() - notif.timestamp) / 60000);
  const timeText = timeAgo < 1 ? 'just now' : `${timeAgo} min ago`;

  alert(`🎉 Tickets Available!\n\n${notif.message}\n\nOpened: ${timeText}`);

  await chrome.storage.local.remove(['lastNotification']);
  chrome.action.setBadgeText({ text: '' });
}

function stopAlert() {
  chrome.runtime.sendMessage({ action: 'stopAlert' }, () => {
    checkAlertStatus();
  });
}

function checkAlertStatus() {
  chrome.runtime.sendMessage({ action: 'getAlertStatus' }, (response) => {
    const btn = document.getElementById('stopAlert');
    if (!btn) return;

    if (response?.isPlaying) {
      btn.style.display = 'inline-block';
      btn.style.width = '100%';
      btn.style.marginTop = '10px';
    } else {
      btn.style.display = 'none';
    }
  });
}

function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  const y = dateStr.substring(0, 4);
  const m = dateStr.substring(4, 6);
  const d = dateStr.substring(6, 8);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function parseUrl() {
  const urlInput = document.getElementById('movieUrl');
  if (!urlInput) return;

  const url = urlInput.value.trim();

  if (!url) {
    alert('Please paste a BookMyShow URL');
    return;
  }

  try {
    // Parse different URL formats
    // Format 1: https://in.bookmyshow.com/movies/chennai/jana-nayagan/buytickets/ET00430817/20260109
    // Format 2: https://in.bookmyshow.com/movies/chennai/jana-nayagan/ET00430817

    const regex = /bookmyshow\.com\/movies\/([^\/]+)\/([^\/]+)\/(buytickets\/)?([A-Z0-9]+)(\/(\d{8}))?/i;
    const match = url.match(regex);

    if (!match) {
      alert('Could not parse URL. Please use format:\nhttps://in.bookmyshow.com/movies/city/movie-name/ET12345\nor\nhttps://in.bookmyshow.com/movies/city/movie-name/buytickets/ET12345/20260109');
      return;
    }

    const city = match[1];
    const movieSlug = match[2];
    const movieId = match[4];
    const targetDate = match[6] || '';

    // Convert slug to title (capitalize words)
    const title = movieSlug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    // Fill in the fields
    document.getElementById('movieTitle').value = title;
    document.getElementById('movieId').value = movieId;
    document.getElementById('movieCity').value = city;
    document.getElementById('targetDate').value = targetDate;

    console.log('Parsed:', { title, movieId, city, targetDate });

    alert(`✅ URL Parsed Successfully!\n\nTitle: ${title}\nID: ${movieId}\nCity: ${city}\nDate: ${targetDate || '(Any date)'}\n\nClick "Add Movie" to save.`);

  } catch (error) {
    console.error('Parse error:', error);
    alert('Error parsing URL. Please check the format.');
  }
}
