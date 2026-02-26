/**
 * Cristal Minas - RCLF Simulation Engine
 * Refactored for Clean Code, KISS, and DRY.
 */

// --- Constants & Config ---
const CONFIG = {
    STOICHIOMETRY: {
        F_TO_CAF2: 78 / 38,
        F_TO_CACL2: 111 / 38
    },
    MARKET: {
        PRICE_METALSPAR: 3000, // BRL/ton (80% purity)
        PRICE_ACIDSPAR: 5500,  // BRL/ton (>97% purity)
        COST_CACL2: 1100,      // BRL/ton
        AVOIDED_COST_LIME_SLUDGE: 7237.5 // BRL/ton of F avoided
    },
    FINANCIAL: {
        CAPEX: 1000000,       // R$ 1 Million as per user request
        OPEX_FIXED_DAY: 1500 // Daily fixed cost (Energy + Labor)
    },
    PHYSICS: {
        TARGET_PH: 8.2,
        GRAVITY: 0.5,
        DRAG_COEFFICIENT: 0.1
    }
};

// --- Specialized Modules ---

/**
 * Handles all chemical and stoichiometry calculations.
 */
class ChemistryEngine {
    constructor() {
        this.currentPH = 7.0;
        this.totalFInput = 0;
        this.totalFluoriteOutput = 0;
        this.totalCaCl2Used = 0;
        this.totalRevenue = 0;
        this.totalVariableCost = 0;
        this.totalFixedCost = 0;
        this.totalSavings = 0;
        this.simTimeMs = 0; // Simulated time in milliseconds
        this.history = []; // Array of daily snapshots { day, revenue, cost }
        this.lastSnapshotDay = -1;
        this.purityMix = 0; // % of Acidspar production (0-100)
    }

    reset() {
        this.currentPH = 7.0;
        this.totalFInput = 0;
        this.totalFluoriteOutput = 0;
        this.totalCaCl2Used = 0;
        this.totalRevenue = 0;
        this.totalVariableCost = 0;
        this.totalSavings = 0;
        this.simTimeMs = 0;
        this.totalFixedCost = 0;
        this.history = [];
        this.lastSnapshotDay = -1;
        this.purityMix = 0;
    }

    calculateReaction(flowRate, ppmF, dt, speed) {
        const effectiveDt = (dt / 1000) * speed;
        // SCALE PRODUCTION BY SIMULATION SPEED (1s real = 4h sim = 14400x)
        const timeMultiplier = 4 * 3600;
        const massF = (flowRate * ppmF / 3600) * effectiveDt * timeMultiplier;

        // Stoichiometry
        const massFluorite = massF * CONFIG.STOICHIOMETRY.F_TO_CAF2;
        const massCaCl2 = massF * CONFIG.STOICHIOMETRY.F_TO_CACL2;

        this.totalFInput += massF;
        this.totalFluoriteOutput += massFluorite;
        this.totalCaCl2Used += massCaCl2;

        // Financial Calculation (Weighted Average Price based on Production Mix)
        const tonsFluorite = massFluorite / 1000000;
        const tonsCaCl2 = massCaCl2 / 1000000;

        const acidPercent = this.purityMix / 100;
        const metalPercent = 1 - acidPercent;
        const weightedPrice = (acidPercent * CONFIG.MARKET.PRICE_ACIDSPAR) + (metalPercent * CONFIG.MARKET.PRICE_METALSPAR);

        this.totalRevenue += tonsFluorite * weightedPrice;
        this.totalVariableCost += tonsCaCl2 * CONFIG.MARKET.COST_CACL2;

        // ESG Savings calculation (per second)
        const tonsF = massF / 1000000;
        this.totalSavings += tonsF * CONFIG.MARKET.AVOIDED_COST_LIME_SLUDGE;

        // Update Simulated Time (1 real sec = 4 hours)
        this.simTimeMs += effectiveDt * timeMultiplier * 1000;

        // Deduced Fixed OPEX based on elapsed simulation days
        const totalDays = this.simTimeMs / (1000 * 24 * 3600);
        this.totalFixedCost = totalDays * CONFIG.FINANCIAL.OPEX_FIXED_DAY;

        // Snapshots for 30-day tracking
        const currentDay = Math.floor(this.simTimeMs / (1000 * 24 * 3600));
        if (currentDay > this.lastSnapshotDay) {
            this.history.push({
                day: currentDay,
                revenue: this.totalRevenue,
                cost: this.totalVariableCost + this.totalFixedCost
            });
            this.lastSnapshotDay = currentDay;
            if (this.history.length > 40) this.history.shift();
        }

        // pH Stability Logic
        const drift = (Math.random() - 0.5) * 0.02;
        this.currentPH += (CONFIG.PHYSICS.TARGET_PH - this.currentPH) * 0.1 + drift;

        return { massF, massFluorite, massCaCl2 };
    }
}

/**
 * Manages the fluidized bed particles and movement.
 */
class PhysicsEngine {
    constructor() {
        this.particles = [];
    }

    reset() {
        this.particles = [];
    }

    updateParticles(dt, speed, flowRate, centerX, centerY) {
        const fluidVelocity = (flowRate / 100) * speed;

        this.particles.forEach((p, i) => {
            p.update(dt, fluidVelocity);
            if (p.isOutOfBounds(centerY) || p.isDead()) {
                this.particles.splice(i, 1);
            }
        });

        if (Math.random() < 0.3 * speed) {
            this.spawnParticle(centerX, centerY);
        }
    }

    spawnParticle(centerX, centerY) {
        const x = centerX + (Math.random() - 0.5) * 120;
        const y = centerY + 180;
        const type = Math.random() > 0.3 ? 'crystal' : 'fluid';
        this.particles.push(new Particle(x, y, 1 + Math.random() * 3, type));
    }
}

/**
 * A single unit in the fluidized bed.
 */
class Particle {
    constructor(x, y, size, type) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.type = type;
        this.vx = (Math.random() - 0.5) * 1;
        this.vy = type === 'crystal' ? Math.random() * 2 : -Math.random() * 3;
        this.alpha = 1;
        this.color = type === 'crystal' ? '#00f2ff' : '#39ff14';
    }

    update(dt, fluidVelocity) {
        if (this.type === 'crystal') {
            const drag = fluidVelocity * CONFIG.PHYSICS.DRAG_COEFFICIENT;
            this.vy += CONFIG.PHYSICS.GRAVITY - drag;
            this.x += this.vx;
            this.y += this.vy;
        } else {
            this.y -= fluidVelocity * 2;
            this.x += Math.sin(this.y * 0.05) * 2;
            this.alpha -= 0.01;
        }
    }

    isOutOfBounds(centerY) {
        return this.y > centerY + 200 || this.y < centerY - 250;
    }

    isDead() {
        return this.alpha <= 0;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        if (this.type === 'crystal') {
            ctx.shadowBlur = 5;
            ctx.shadowColor = this.color;
        }
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

/**
 * Main Orchestrator.
 */
class Simulation {
    constructor() {
        this.canvas = document.getElementById('simCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.chem = new ChemistryEngine();
        this.phys = new PhysicsEngine();

        this.state = {
            running: false,
            speed: 1.0,
            flowRate: 450,
            ppmF: 50 // This matches mg/L in water simulation
        };

        this.init();
    }

    init() {
        this.resize();
        this.setupListeners();
        window.addEventListener('resize', () => this.resize());
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
        const bounds = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = bounds.width;
        this.canvas.height = bounds.height;
    }

    setupListeners() {
        const bind = (id, prop, callback) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.oninput = (e) => {
                this.state[prop] = parseFloat(e.target.value);
                if (callback) callback(this.state[prop]);
            };
        };

        bind('speedControl', 'speed', (v) => document.getElementById('speedVal').innerText = v.toFixed(1) + 'x');
        bind('flowControl', 'flowRate', (v) => document.getElementById('flowVal').innerText = v + ' m³/h');
        bind('concControl', 'ppmF', (v) => document.getElementById('concVal').innerText = v + ' mg/L');

        document.getElementById('toggleSystem').onclick = () => {
            this.state.running = !this.state.running;
            this.updateSystemStatus();
        };

        document.getElementById('resetSystem').onclick = () => this.reset();

        bind('purityControl', 'purityMix', (v) => {
            this.chem.purityMix = v;
            document.getElementById('purityVal').innerText = v.toFixed(0) + '% Acidspar';
        });
    }

    reset() {
        this.state.running = false;
        this.chem.reset();
        this.phys.reset();
        this.updateSystemStatus();
        this.updateUI({ massCaCl2: 0 });
    }

    updateSystemStatus() {
        const btn = document.getElementById('toggleSystem');
        const status = document.getElementById('statusText');
        btn.innerText = this.state.running ? 'PARAR PROCESSO' : 'INICIAR PROCESSO';
        status.innerText = this.state.running ? 'SISTEMA ONLINE - AUTOMATIZADO' : 'SISTEMA EM ESPERA';
        status.style.color = this.state.running ? 'var(--accent-green)' : 'var(--text-secondary)';
    }

    updateUI(results) {
        const set = (id, val) => document.getElementById(id).innerText = val;
        const formatBRL = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

        set('fInput', (this.chem.totalFInput / 1000).toFixed(2) + ' kg');
        set('fluoriteOutput', (this.chem.totalFluoriteOutput / 1000).toFixed(2) + ' kg');
        set('phLevel', this.chem.currentPH.toFixed(2));

        // Show auto-calculated dosing
        document.getElementById('dosingVal').innerText = `AUTO: ${results.massCaCl2.toFixed(2)} g/s`;

        // Monthly Estimation Calculation (EBITDA = Revenue - Costs + Avoided Costs)
        const monthlyRevenue = this.chem.totalRevenue;
        const monthlyVarCost = this.chem.totalVariableCost;
        const totalCost = monthlyVarCost + (this.chem.totalFixedCost || 0);
        const netProfit = (monthlyRevenue - totalCost) + this.chem.totalSavings;

        // ROI Calculation
        const roi = (netProfit / CONFIG.FINANCIAL.CAPEX) * 100;

        // Time Formatting
        const totalSeconds = this.chem.simTimeMs / 1000;
        const days = Math.floor(totalSeconds / (24 * 3600));
        const months = Math.floor(days / 30);
        const remainingDays = days % 30;

        let timeStr = "";
        if (months > 0) timeStr += `${months}m `;
        timeStr += `${remainingDays}d`;
        if (months === 0 && remainingDays === 0) {
            const hours = Math.floor((totalSeconds / 3600) % 24);
            timeStr = `${hours}h`;
        }

        set('revenueValue', 'R$ ' + formatBRL(monthlyRevenue));
        set('profitValue', 'R$ ' + formatBRL(netProfit));
        set('savingsValue', 'R$ ' + formatBRL(this.chem.totalSavings));
        set('roiValue', roi.toFixed(2) + '%');
        set('simTime', timeStr);

        // Calculate 30-day rolling financials
        let rev30 = 0;
        let pro30 = 0;
        if (this.chem.history.length > 1) {
            const now = this.chem.history[this.chem.history.length - 1];
            // Find snapshot closest to 30 days ago
            const targetDay = now.day - 30;
            const prev = this.chem.history.find(h => h.day >= targetDay) || this.chem.history[0];

            rev30 = now.revenue - prev.revenue;
            pro30 = (now.revenue - now.cost) - (prev.revenue - prev.cost);
        } else {
            // Initial phase: just show current accumulated
            rev30 = monthlyRevenue;
            pro30 = netProfit;
        }

        set('revenue30d', 'R$ ' + formatBRL(rev30));
        set('profit30d', 'R$ ' + formatBRL(pro30));

        set('cacl2Used', (this.chem.totalCaCl2Used / 1000).toFixed(2) + ' kg');

        // Dynamic Efficiency based on pH stability (Target 8.2)
        const phError = Math.abs(this.chem.currentPH - 8.2);
        const efficiency = Math.max(0, 99.8 - (phError * 15));
        set('efficiencyVal', efficiency.toFixed(1) + '%');
    }

    loop(time) {
        const dt = time - this.lastTime;
        this.lastTime = time;

        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        if (this.state.running) {
            const results = this.chem.calculateReaction(this.state.flowRate, this.state.ppmF, dt, this.state.speed);
            this.phys.updateParticles(dt, this.state.speed, this.state.flowRate, centerX, centerY);
            this.updateUI(results);
        }

        this.draw(centerX, centerY);
        requestAnimationFrame((t) => this.loop(t));
    }

    draw(centerX, centerY) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawScene(centerX, centerY);
        this.phys.particles.forEach(p => p.draw(this.ctx));
    }

    drawScene(centerX, centerY) {
        const ctx = this.ctx;

        // Support
        ctx.fillStyle = '#2d3748';
        ctx.fillRect(centerX - 100, centerY + 200, 200, 20);

        // Reactor
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX - 80, centerY + 200);
        ctx.lineTo(centerX - 80, centerY - 150);
        ctx.arc(centerX, centerY - 150, 80, Math.PI, 0, false);
        ctx.lineTo(centerX + 80, centerY + 200);
        ctx.closePath();
        ctx.stroke();

        // Liquid
        const grad = ctx.createLinearGradient(0, centerY - 150, 0, centerY + 200);
        grad.addColorStop(0, 'rgba(0, 242, 255, 0.05)');
        grad.addColorStop(1, 'rgba(0, 242, 255, 0.15)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Pipe animation
        this.drawPipe(centerX - 250, centerY + 180, centerX - 80, centerY + 180);
    }

    drawPipe(x1, y1, x2, y2) {
        const ctx = this.ctx;
        ctx.lineWidth = 15;
        ctx.strokeStyle = '#1a202c';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (this.state.running) {
            ctx.strokeStyle = 'rgba(0, 242, 255, 0.4)';
            ctx.setLineDash([10, 20]);
            ctx.lineDashOffset = -performance.now() * 0.1 * this.state.speed;
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

window.onload = () => new Simulation();
