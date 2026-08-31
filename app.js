// =====================================================
// MICROSEP — Companion App Logic
// =====================================================

(function () {
  'use strict';

  // -------------------------------------------------
  // GLOBALS
  // -------------------------------------------------
  const serial = new MicrosepSerial();
  let currentPage = 'dashboard';
  let processStartTime = null;  // total elapsed tracking
  let lastStatus = null;
  let runLog = [];              // stage transition log for current run
  let currentRunMeta = null;    // experiment metadata for current run

  const STAGES_ORDER = [
    'DOSING', 'AGITATING_1', 'SETTLING_1', 'OVERFLOW_1',
    'AGITATING_2', 'SETTLING_2', 'OVERFLOW_2', 'DRAINAGE'
  ];

  const STAGE_LABELS = {
    'INIT': 'Initializing',
    'DOSING': 'Dosing',
    'AGITATING_1': 'Agitation #1',
    'SETTLING_1': 'Settling #1',
    'OVERFLOW_1': 'Overflow #1',
    'AGITATING_2': 'Agitation #2',
    'SETTLING_2': 'Settling #2',
    'OVERFLOW_2': 'Overflow #2',
    'DRAINAGE': 'Drainage',
    'COMPLETE': 'Complete',
    'ERROR': 'Error',
    'CALIBRATING': 'Calibrating'
  };

  // -------------------------------------------------
  // NAVIGATION
  // -------------------------------------------------
  function initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        switchPage(page);
      });
    });
  }

  function switchPage(page) {
    currentPage = page;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`).classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) {
      el.classList.add('active');
      // Re-trigger animation
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
    }
  }

  // -------------------------------------------------
  // SERIAL CONNECTION
  // -------------------------------------------------
  function initConnection() {
    const btnConnect = document.getElementById('btn-connect');

    if (!MicrosepSerial.isSupported()) {
      btnConnect.textContent = 'Serial Not Supported';
      btnConnect.disabled = true;
      return;
    }

    btnConnect.addEventListener('click', async () => {
      if (serial.connected) {
        await serial.disconnect();
      } else {
        try {
          await serial.connect();
        } catch (e) {
          console.error('Connection failed:', e);
        }
      }
    });

    serial.onConnect = () => {
      updateConnectionUI(true);
      enableControls(true);
      // Request current parameters from Arduino
      setTimeout(() => serial.send('CMD:PARAMS'), 500);
    };

    serial.onDisconnect = () => {
      updateConnectionUI(false);
      enableControls(false);
    };

    serial.onData = (data) => {
      handleArduinoData(data);
    };

    serial.onRawLine = (line) => {
      // Debug log (optional)
      // console.log('RX:', line);
    };
  }

  function updateConnectionUI(connected) {
    const dot = document.querySelector('#btn-connect .connect-dot');
    const btn = document.getElementById('btn-connect');
    const connDot = document.querySelector('.conn-dot');
    const connText = document.getElementById('conn-text');

    if (connected) {
      dot.className = 'connect-dot connected';
      btn.innerHTML = '<span class="connect-dot connected"></span>Connected';
      if (connDot) connDot.className = 'conn-dot connected';
      if (connText) connText.textContent = 'Connected';
    } else {
      dot.className = 'connect-dot disconnected';
      btn.innerHTML = '<span class="connect-dot disconnected"></span>Connect Arduino';
      if (connDot) connDot.className = 'conn-dot';
      if (connText) connText.textContent = 'Disconnected';
      resetDashboard();
    }
  }

  function enableControls(enabled) {
    const ids = [
      'btn-start', 'btn-stop', 'btn-reset',
      'btn-stop-monitor',
      'btn-enter-calib', 'btn-exit-calib',
      'calib-pump-btn', 'calib-air-btn', 'calib-servo-slider',
      'btn-send-params', 'btn-begin-run'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    });
  }

  // -------------------------------------------------
  // INCOMING DATA HANDLER
  // -------------------------------------------------
  function handleArduinoData(data) {
    // Event messages
    if (data.ev) {
      handleEvent(data);
      return;
    }

    // Status updates (periodic)
    if (data.st !== undefined) {
      lastStatus = data;
      updateDashboard(data);
      updateMonitor(data);
      updateCalibSensor(data);
    }
  }

  function handleEvent(data) {
    switch (data.ev) {
      case 'STATE':
        logStageTransition(data.st);
        if (data.st === 'DOSING' && !processStartTime) {
          processStartTime = Date.now();
          runLog = [];
        }
        if (data.st === 'COMPLETE') {
          saveRun('COMPLETE');
          processStartTime = null;
        }
        break;

      case 'ESTOP':
        saveRun('E-STOP');
        processStartTime = null;
        break;

      case 'ERROR':
        saveRun('ERROR: ' + (data.r || 'Unknown'));
        processStartTime = null;
        break;

      case 'PARAMS':
        populateParams(data);
        break;

      case 'BOOT':
        console.log('Arduino booted');
        break;

      case 'SET':
        console.log('Param set:', data.p, '=', data.v, data.ok ? 'OK' : 'FAIL');
        break;
    }
  }

  function logStageTransition(stage) {
    runLog.push({
      stage: stage,
      time: Date.now(),
      elapsed: processStartTime ? Date.now() - processStartTime : 0
    });
  }

  // -------------------------------------------------
  // DASHBOARD UPDATES
  // -------------------------------------------------
  function updateDashboard(s) {
    const statusEl = document.getElementById('dash-status');
    const stateEl = document.getElementById('dash-state');
    const timerEl = document.getElementById('dash-timer');

    // Status display
    const label = STAGE_LABELS[s.st] || s.st;
    statusEl.textContent = label.toUpperCase();
    statusEl.className = 'status-display ' + getStatusClass(s.st);
    stateEl.textContent = getStatusDescription(s.st);

    // Stage timer
    timerEl.textContent = formatMs(s.el);

    // Actuators
    updateActuator('dash-pump', s.pump, 'ON', 'OFF');
    updateActuator('dash-air', s.air, 'ON', 'OFF');
    updateActuator('dash-sensor', s.sensor, 'DETECTED', '---', 'detected');
    updateActuator('dash-servo', s.servo > 10 ? 1 : 0, 'OPEN (' + s.servo + '°)', 'CLOSED');

    // Button states
    const canStart = ['INIT', 'COMPLETE', 'ERROR', 'CALIBRATING'].includes(s.st);
    const isRunning = !['INIT', 'COMPLETE', 'ERROR', 'CALIBRATING'].includes(s.st);
    document.getElementById('btn-start').disabled = !serial.connected || !canStart;
    document.getElementById('btn-stop').disabled = !serial.connected || !isRunning;
    document.getElementById('btn-reset').disabled = !serial.connected;
    document.getElementById('btn-stop-monitor').disabled = !serial.connected || !isRunning;
  }

  function updateActuator(id, value, onText, offText, onClass) {
    const el = document.getElementById(id);
    if (!el) return;
    const dot = el.querySelector('.indicator-dot');
    const span = el.querySelector('span');
    if (value) {
      dot.className = 'indicator-dot ' + (onClass || 'on');
      span.textContent = onText;
    } else {
      dot.className = 'indicator-dot';
      span.textContent = offText;
    }
  }

  function getStatusClass(st) {
    if (st === 'INIT' || st === 'CALIBRATING') return 'ready';
    if (st === 'COMPLETE') return 'complete';
    if (st === 'ERROR') return 'error';
    return 'active';
  }

  function getStatusDescription(st) {
    const desc = {
      'INIT': 'System ready — waiting to start',
      'DOSING': 'Peristaltic pump filling chamber with ZnCl₂',
      'AGITATING_1': 'Air pump suspending particles in solution',
      'SETTLING_1': 'Waiting for density separation',
      'OVERFLOW_1': 'Collecting first buoyant fraction',
      'AGITATING_2': 'Resuspending remaining particles',
      'SETTLING_2': 'Second density separation period',
      'OVERFLOW_2': 'Collecting additional buoyant fraction',
      'DRAINAGE': 'Draining sediment from chamber',
      'COMPLETE': 'Process finished successfully',
      'ERROR': 'System error — check Arduino',
      'CALIBRATING': 'Manual actuator testing mode'
    };
    return desc[st] || '';
  }

  function resetDashboard() {
    const statusEl = document.getElementById('dash-status');
    statusEl.textContent = 'DISCONNECTED';
    statusEl.className = 'status-display';
    document.getElementById('dash-state').textContent = 'Connect Arduino to begin';
    document.getElementById('dash-timer').textContent = '--:--';
  }

  // -------------------------------------------------
  // LIVE MONITOR UPDATES
  // -------------------------------------------------
  function updateMonitor(s) {
    // Stage name
    document.getElementById('mon-stage').textContent = STAGE_LABELS[s.st] || s.st;

    // Stage timer
    document.getElementById('mon-timer').textContent = formatMs(s.el);

    // Actuator values
    setMonitorValue('mon-pump', s.pump, 'ON', 'OFF');
    setMonitorValue('mon-air', s.air, 'ON', 'OFF');
    setMonitorValue('mon-sensor', s.sensor, 'DETECTED', '---', 'detected');
    document.getElementById('mon-servo').textContent = s.servo > 10 ? 'OPEN' : 'CLOSED';

    // Total timer
    if (processStartTime) {
      const total = Date.now() - processStartTime;
      document.getElementById('monitor-total').textContent = 'Total: ' + formatMsFull(total);
    }

    // Timeline
    updateTimeline(s.st);
  }

  function setMonitorValue(id, value, onText, offText, onClass) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value ? onText : offText;
    el.className = 'monitor-value' + (value ? (' ' + (onClass || 'on')) : '');
  }

  function updateTimeline(currentStage) {
    const stageIndex = STAGES_ORDER.indexOf(currentStage);

    document.querySelectorAll('.timeline-stage').forEach(el => {
      const stage = el.dataset.stage;
      const idx = STAGES_ORDER.indexOf(stage);

      el.classList.remove('active', 'completed');

      if (currentStage === 'COMPLETE') {
        el.classList.add('completed');
      } else if (idx < stageIndex) {
        el.classList.add('completed');
      } else if (idx === stageIndex) {
        el.classList.add('active');
      }
    });
  }

  // -------------------------------------------------
  // CALIBRATION
  // -------------------------------------------------
  function initCalibration() {
    const pumpBtn = document.getElementById('calib-pump-btn');
    const airBtn = document.getElementById('calib-air-btn');
    const servoSlider = document.getElementById('calib-servo-slider');
    const enterBtn = document.getElementById('btn-enter-calib');
    const exitBtn = document.getElementById('btn-exit-calib');

    let pumpOn = false;
    let airOn = false;

    pumpBtn.addEventListener('click', () => {
      pumpOn = !pumpOn;
      serial.send('CMD:PUMP_TEST:' + (pumpOn ? 'ON' : 'OFF'));
      pumpBtn.textContent = pumpOn ? 'ON' : 'OFF';
      pumpBtn.classList.toggle('on', pumpOn);
    });

    airBtn.addEventListener('click', () => {
      airOn = !airOn;
      serial.send('CMD:AIR_TEST:' + (airOn ? 'ON' : 'OFF'));
      airBtn.textContent = airOn ? 'ON' : 'OFF';
      airBtn.classList.toggle('on', airOn);
    });

    servoSlider.addEventListener('input', () => {
      const val = servoSlider.value;
      document.getElementById('calib-servo-value').textContent = val + '°';
      serial.send('CMD:SERVO_TEST:' + val);
    });

    enterBtn.addEventListener('click', () => {
      serial.send('CMD:CALIB');
      pumpOn = false;
      airOn = false;
      pumpBtn.textContent = 'OFF';
      pumpBtn.classList.remove('on');
      airBtn.textContent = 'OFF';
      airBtn.classList.remove('on');
      servoSlider.value = 0;
      document.getElementById('calib-servo-value').textContent = '0°';
    });

    exitBtn.addEventListener('click', () => {
      serial.send('CMD:RESET');
    });

    // Flow rate calculator
    const volInput = document.getElementById('flow-volume');
    const durInput = document.getElementById('flow-duration');
    const rateDisplay = document.getElementById('flow-rate');

    function calcFlow() {
      const vol = parseFloat(volInput.value);
      const dur = parseFloat(durInput.value);
      if (vol > 0 && dur > 0) {
        const rate = vol / dur;
        rateDisplay.textContent = rate.toFixed(2) + ' mL/s';
        // Auto-save to experiment page
        localStorage.setItem('microsep_flow_rate', rate.toFixed(2));
        const expFlowRate = document.getElementById('param-flow-rate');
        if (expFlowRate) expFlowRate.value = rate.toFixed(2);
      } else {
        rateDisplay.textContent = '--- mL/s';
      }
    }
    volInput.addEventListener('input', calcFlow);
    durInput.addEventListener('input', calcFlow);
  }

  function updateCalibSensor(s) {
    const el = document.getElementById('calib-sensor');
    if (!el) return;
    const dot = el.querySelector('.sensor-dot');
    const span = el.querySelector('span');
    if (s.sensor) {
      dot.className = 'sensor-dot detected';
      span.textContent = 'DETECTED';
    } else {
      dot.className = 'sensor-dot';
      span.textContent = 'Not detected';
    }
  }

  // -------------------------------------------------
  // EXPERIMENT SETUP
  // -------------------------------------------------
  function initExperiment() {
    const sendBtn = document.getElementById('btn-send-params');
    const beginBtn = document.getElementById('btn-begin-run');
    const flowRateInput = document.getElementById('param-flow-rate');
    const ovfVolumeInput = document.getElementById('param-ovf-volume');
    const calcDisplay = document.getElementById('calc-ovf-time');
    const ovfPumpHidden = document.getElementById('param-ovf-pump');

    // Load saved flow rate from calibration
    const savedRate = localStorage.getItem('microsep_flow_rate');
    if (savedRate) {
      flowRateInput.value = savedRate;
    }

    // Auto-calculate overflow pump time
    function calcOverflowTime() {
      const rate = parseFloat(flowRateInput.value);
      const volume = parseFloat(ovfVolumeInput.value);
      if (rate > 0 && volume > 0) {
        const timeSec = volume / rate;
        const timeMs = Math.round(timeSec * 1000);
        calcDisplay.textContent = timeSec.toFixed(1) + ' s  →  ' + timeMs + ' ms';
        ovfPumpHidden.value = timeMs;
      } else {
        calcDisplay.textContent = '--- (enter volume and flow rate)';
        ovfPumpHidden.value = 0;
      }
    }

    flowRateInput.addEventListener('input', () => {
      calcOverflowTime();
      localStorage.setItem('microsep_flow_rate', flowRateInput.value);
    });
    ovfVolumeInput.addEventListener('input', calcOverflowTime);

    // Calculate on page load
    calcOverflowTime();

    sendBtn.addEventListener('click', () => {
      sendAllParams();
    });

    beginBtn.addEventListener('click', () => {
      currentRunMeta = {
        sampleId: document.getElementById('exp-sample-id').value || 'Unknown',
        plasticType: document.getElementById('exp-plastic-type').value || '',
        sampleMass: document.getElementById('exp-sample-mass').value || '',
        zncl2Vol: document.getElementById('exp-zncl2-vol').value || '',
        zncl2Conc: document.getElementById('exp-zncl2-conc').value || '',
        trial: document.getElementById('exp-trial').value || '1',
        operator: document.getElementById('exp-operator').value || '',
        notes: document.getElementById('exp-notes').value || '',
        flowRate: flowRateInput.value || '',
        overflowVolume: ovfVolumeInput.value || ''
      };

      sendAllParams();
      setTimeout(() => {
        serial.send('CMD:START');
        switchPage('monitor');
      }, 300);
    });
  }

  function sendAllParams() {
    const paramMap = [
      ['param-dosing',      'DOSING_TIME'],
      ['param-agit1',       'AGITATION_1_TIME'],
      ['param-settl1',      'SETTLING_1_TIME'],
      ['param-arm',         'SENSOR_ARM_DELAY'],
      ['param-ovf-timeout', 'OVERFLOW_TIMEOUT'],
      ['param-ovf-pump',    'OVERFLOW_PUMP_TIME'],
      ['param-agit2',       'AGITATION_2_TIME'],
      ['param-settl2',      'SETTLING_2_TIME'],
      ['param-drain',       'DRAINAGE_TIME']
    ];

    let delay = 0;
    paramMap.forEach(([inputId, paramName]) => {
      const el = document.getElementById(inputId);
      if (el) {
        const val = parseInt(el.value, 10);
        if (!isNaN(val)) {
          setTimeout(() => {
            serial.send(`CMD:SET:${paramName}:${val}`);
          }, delay);
          delay += 50; // Stagger to avoid overloading serial buffer
        }
      }
    });
  }

  function populateParams(data) {
    const fieldMap = {
      'DOSING_TIME': 'param-dosing',
      'AGITATION_1_TIME': 'param-agit1',
      'SETTLING_1_TIME': 'param-settl1',
      'SENSOR_ARM_DELAY': 'param-arm',
      'OVERFLOW_TIMEOUT': 'param-ovf-timeout',
      'OVERFLOW_PUMP_TIME': 'param-ovf-pump',
      'AGITATION_2_TIME': 'param-agit2',
      'SETTLING_2_TIME': 'param-settl2',
      'DRAINAGE_TIME': 'param-drain'
    };

    Object.entries(fieldMap).forEach(([param, inputId]) => {
      if (data[param] !== undefined) {
        const el = document.getElementById(inputId);
        if (el) el.value = data[param];
      }
    });

    // Recalculate overflow display from Arduino's current value
    if (data['OVERFLOW_PUMP_TIME'] !== undefined) {
      const timeMs = data['OVERFLOW_PUMP_TIME'];
      const rateEl = document.getElementById('param-flow-rate');
      const volEl = document.getElementById('param-ovf-volume');
      const calcEl = document.getElementById('calc-ovf-time');
      if (rateEl && volEl && calcEl) {
        const rate = parseFloat(rateEl.value);
        if (rate > 0) {
          // Reverse-calculate volume from Arduino's time
          const vol = (timeMs / 1000) * rate;
          volEl.value = vol.toFixed(1);
          calcEl.textContent = (timeMs / 1000).toFixed(1) + ' s  →  ' + timeMs + ' ms';
        }
      }
    }
  }

  // -------------------------------------------------
  // RUN HISTORY
  // -------------------------------------------------
  function saveRun(result) {
    const run = {
      id: Date.now(),
      date: new Date().toISOString(),
      result: result,
      meta: currentRunMeta || { sampleId: 'Quick Run' },
      log: [...runLog],
      totalTime: processStartTime ? Date.now() - processStartTime : 0,
      params: getParamsFromUI()
    };

    let history = loadHistory();
    history.unshift(run);
    // Keep last 100 runs
    if (history.length > 100) history = history.slice(0, 100);
    localStorage.setItem('microsep_history', JSON.stringify(history));

    renderHistory();
    currentRunMeta = null;
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem('microsep_history') || '[]');
    } catch {
      return [];
    }
  }

  function renderHistory() {
    const container = document.getElementById('history-list');
    const history = loadHistory();

    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state">No runs recorded yet. Complete an experiment to see it here.</div>';
      return;
    }

    container.innerHTML = history.map(run => {
      const statusClass = run.result === 'COMPLETE' ? 'complete' : 'error';
      const date = new Date(run.date);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="history-item" data-run-id="${run.id}">
          <div class="history-left">
            <div class="history-status ${statusClass}"></div>
            <div>
              <div class="history-id">${escapeHtml(run.meta?.sampleId || 'Run')}</div>
              <div class="history-trial">Trial ${run.meta?.trial || '?'} — ${run.result}</div>
            </div>
          </div>
          <div class="history-right">
            <div class="history-date">${dateStr}</div>
            <div class="history-duration">${formatMsFull(run.totalTime)}</div>
          </div>
        </div>
      `;
    }).join('');

    // Click to view details
    container.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.runId, 10);
        showRunDetail(id);
      });
    });
  }

  function showRunDetail(id) {
    const history = loadHistory();
    const run = history.find(r => r.id === id);
    if (!run) return;

    const container = document.getElementById('history-list');
    const date = new Date(run.date);
    const meta = run.meta || {};

    let stageLog = '';
    if (run.log && run.log.length > 0) {
      stageLog = run.log.map(entry => {
        const label = STAGE_LABELS[entry.stage] || entry.stage;
        const elapsed = formatMsFull(entry.elapsed);
        return `<div class="history-log-entry"><span>${label}</span><span class="mono">${elapsed}</span></div>`;
      }).join('');
    }

    container.innerHTML = `
      <div class="card" style="padding: 28px;">
        <button class="action-btn reset-btn small" id="btn-back-history" style="margin-bottom: 20px;">← Back to List</button>
        <div class="card-label">${escapeHtml(meta.sampleId || 'Run')} — Trial ${meta.trial || '?'}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
          <div>
            <div class="detail-row"><span class="detail-label">Date:</span> ${date.toLocaleString()}</div>
            <div class="detail-row"><span class="detail-label">Result:</span> <strong style="color: ${run.result === 'COMPLETE' ? 'var(--green)' : 'var(--red)'}">${run.result}</strong></div>
            <div class="detail-row"><span class="detail-label">Total Time:</span> <span class="mono">${formatMsFull(run.totalTime)}</span></div>
            <div class="detail-row"><span class="detail-label">Operator:</span> ${escapeHtml(meta.operator || '---')}</div>
          </div>
          <div>
            <div class="detail-row"><span class="detail-label">Plastic Type:</span> ${escapeHtml(meta.plasticType || '---')}</div>
            <div class="detail-row"><span class="detail-label">Sample Mass:</span> ${meta.sampleMass || '---'} g</div>
            <div class="detail-row"><span class="detail-label">ZnCl₂ Volume:</span> ${meta.zncl2Vol || '---'} mL</div>
            <div class="detail-row"><span class="detail-label">ZnCl₂ Conc.:</span> ${escapeHtml(meta.zncl2Conc || '---')}</div>
          </div>
        </div>
        ${meta.notes ? `<div class="detail-row" style="margin-bottom:16px;"><span class="detail-label">Notes:</span> ${escapeHtml(meta.notes)}</div>` : ''}
        <div class="card-label" style="margin-top:8px;">Stage Log</div>
        <div class="history-log">${stageLog || '<span style="color:var(--text-muted)">No stage data recorded</span>'}</div>
      </div>
    `;

    // Inject detail styles
    if (!document.getElementById('detail-styles')) {
      const style = document.createElement('style');
      style.id = 'detail-styles';
      style.textContent = `
        .detail-row { font-size: 14px; color: var(--text-secondary); margin-bottom: 6px; }
        .detail-label { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .detail-row .mono { font-family: var(--mono); color: var(--accent); }
        .history-log { display: flex; flex-direction: column; gap: 4px; }
        .history-log-entry { display: flex; justify-content: space-between; padding: 6px 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); font-size: 13px; color: var(--text-secondary); }
        .history-log-entry .mono { font-family: var(--mono); color: var(--accent); font-size: 12px; }
      `;
      document.head.appendChild(style);
    }

    document.getElementById('btn-back-history').addEventListener('click', () => {
      renderHistory();
    });
  }

  function getParamsFromUI() {
    return {
      dosingTime: document.getElementById('param-dosing')?.value,
      agitation1Time: document.getElementById('param-agit1')?.value,
      settling1Time: document.getElementById('param-settl1')?.value,
      sensorArmDelay: document.getElementById('param-arm')?.value,
      overflowTimeout: document.getElementById('param-ovf-timeout')?.value,
      overflowPumpTime: document.getElementById('param-ovf-pump')?.value,
      agitation2Time: document.getElementById('param-agit2')?.value,
      settling2Time: document.getElementById('param-settl2')?.value,
      drainageTime: document.getElementById('param-drain')?.value
    };
  }

  // -------------------------------------------------
  // ACTION BUTTONS
  // -------------------------------------------------
  function initActions() {
    document.getElementById('btn-start').addEventListener('click', () => {
      serial.send('CMD:START');
      switchPage('monitor');
    });

    document.getElementById('btn-stop').addEventListener('click', () => {
      serial.send('CMD:STOP');
    });

    document.getElementById('btn-stop-monitor').addEventListener('click', () => {
      serial.send('CMD:STOP');
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      serial.send('CMD:RESET');
      processStartTime = null;
    });

    document.getElementById('btn-clear-history').addEventListener('click', () => {
      if (confirm('Clear all run history?')) {
        localStorage.removeItem('microsep_history');
        renderHistory();
      }
    });
  }

  // -------------------------------------------------
  // UTILITIES
  // -------------------------------------------------
  function formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  function formatMsFull(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // -------------------------------------------------
  // INIT
  // -------------------------------------------------
  function init() {
    initNav();
    initConnection();
    initActions();
    initCalibration();
    initExperiment();
    renderHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
