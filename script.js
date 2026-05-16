/**
 * SpendWise - Core Logic
 * Handles state, local storage, multi-view navigation, and smart filtering.
 */

class SpendWise {
    constructor() {
        // --- Firebase Configuration ---
        // INSTRUCTIONS: Go to Firebase Console -> Project Settings -> Add App (Web)
        // Copy your config here:
        this.firebaseConfig = {
            apiKey: "AIzaSyCtKVL-Z7rCJxRxqZy8jzUyDTXOnRYGZn0",
            authDomain: "spendwise-4547a.firebaseapp.com",
            databaseURL: "https://spendwise-4547a-default-rtdb.firebaseio.com",
            projectId: "spendwise-4547a",
            storageBucket: "spendwise-4547a.firebasestorage.app",
            messagingSenderId: "894577451873",
            appId: "1:894577451873:web:5b0a71323d13cd27ccdb20",
            measurementId: "G-50GN706J9W"
        };

        this.db = null;
        this.vaultId = 'spendwise-4547a-vault'; // Using a unique ID based on your project
        this.isLive = false;

        // Initialize Local State
        this.transactions = JSON.parse(localStorage.getItem('transactions')) || [];
        this.budget = parseFloat(localStorage.getItem('monthlyBudget')) || 0;

        const defaultCategories = {
            Salary: { icon: 'banknote', color: '#00ff88' },
            Food: { icon: 'utensils', color: '#ffb703' },
            Transport: { icon: 'car', color: '#00e5ff' },
            Housing: { icon: 'home', color: '#7000ff' },
            Tech: { icon: 'cpu', color: '#ff4d6d' },
            Entertainment: { icon: 'clapperboard', color: '#ff00ff' },
            Debt: { icon: 'landmark', color: '#94a3b8' },
            Other: { icon: 'help-circle', color: '#94a3b8' }
        };
        this.categories = JSON.parse(localStorage.getItem('categories')) || defaultCategories;

        this.settings = JSON.parse(localStorage.getItem('settings')) || {
            username: 'Mr Hacker',
            accent: '#00e5ff',
            theme: 'dark'
        };

        this.editingId = null;
        this.editingCategoryId = null;
        this.auditLog = JSON.parse(localStorage.getItem('auditLog')) || [];
        this.lastTransactionId = parseInt(localStorage.getItem('lastTransactionId')) || 0;

        this.init();
    }

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.initCharts();
        this.applySettings();
        this.updatePeriodSelector();
        this.updateTransactionFormCategories();

        this.initFirebase();
        this.updateSyncStatus();
        this.updateUI();
    }

    updateSyncStatus() {
        const badge = document.getElementById('sync-status');
        if (!badge) return;

        if (this.isLive) {
            badge.classList.remove('offline');
            badge.classList.add('online');
            badge.querySelector('.status-text').textContent = 'Cloud Active';
        } else {
            badge.classList.remove('online');
            badge.classList.add('offline');
            badge.querySelector('.status-text').textContent = 'Offline';
        }
    }

    initFirebase() {
        if (!this.firebaseConfig.apiKey.startsWith('PASTE')) {
            try {
                firebase.initializeApp(this.firebaseConfig);
                this.db = firebase.database();
                this.isLive = true;
                this.syncWithCloud();
                console.log("🚀 Firebase Live Sync Active");
            } catch (err) {
                console.error("❌ Firebase Init Failed:", err);
                this.showToast("Cloud Sync Failed. Running offline.", "error");
            }
        } else {
            console.warn("⚠️ Firebase Config not provided. Running in Offline Mode.");
        }
    }

    async syncWithCloud() {
        if (!this.isLive) return;

        const vaultRef = this.db.ref(`vaults/${this.vaultId}`);

        // Initial Fetch
        vaultRef.once('value', (snapshot) => {
            const cloudData = snapshot.val();
            if (cloudData) {
                console.log("📥 Loading existing Cloud Data...");
                this.transactions = cloudData.transactions || [];
                this.budget = cloudData.budget || 0;
                this.categories = cloudData.categories || this.categories;
                this.settings = cloudData.settings || this.settings;
                this.auditLog = cloudData.auditLog || [];
                
                // FORCE RE-INDEX ON SYNC to ensure strict 1..N order
                this.reindexTransactions();
                
                this.saveToLocal();
                this.updateUI();
                this.showToast("Cloud Vault Synced", "success");
            } else {
                // CLOUD IS EMPTY - This is likely the first time connection
                console.log("📤 Cloud is empty. Performing initial upload...");
                this.saveToCloud(); // Push local data to the new cloud vault
                this.showToast("Initial Cloud Backup Created!", "success");
            }
        });

        // Listen for remote changes
        vaultRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.lastUpdateBy !== 'self') {
                this.transactions = data.transactions || [];
                this.budget = data.budget || 0;
                this.updateUI();
            }
        });
    }

    saveAndRefresh() {
        this.saveToLocal();
        this.saveToCloud();
        this.updateUI();
    }

    saveToLocal() {
        localStorage.setItem('transactions', JSON.stringify(this.transactions));
        localStorage.setItem('monthlyBudget', this.budget);
        localStorage.setItem('categories', JSON.stringify(this.categories));
        localStorage.setItem('settings', JSON.stringify(this.settings));
        localStorage.setItem('auditLog', JSON.stringify(this.auditLog));
        localStorage.setItem('lastTransactionId', this.lastTransactionId);
    }

    saveToCloud() {
        if (!this.isLive) return;
        
        this.db.ref(`vaults/${this.vaultId}`).set({
            transactions: this.transactions,
            budget: this.budget,
            categories: this.categories,
            settings: this.settings,
            auditLog: this.auditLog,
            lastTransactionId: this.lastTransactionId,
            lastUpdateBy: 'self',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    }

    reindexTransactions() {
        if (!this.transactions || this.transactions.length === 0) {
            this.lastTransactionId = 0;
            return;
        }

        // Sort by date ascending to assign IDs 1...N in order of time
        this.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        this.transactions.forEach((t, index) => {
            t.id = index + 1;
        });

        this.lastTransactionId = this.transactions.length;

        // Sort back to descending (Newest first) for the UI
        this.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    cacheDOM() {
        // Modals
        this.expenseModal = document.getElementById('expense-modal');
        this.budgetModal = document.getElementById('budget-modal');
        this.categoryModal = document.getElementById('category-modal');
        this.confirmModal = document.getElementById('confirm-modal');

        // Buttons
        this.addExpenseBtn = document.getElementById('add-expense-btn');
        this.addCategoryBtn = document.getElementById('add-category-btn');
        this.closeModalBtns = document.querySelectorAll('.close-modal');

        // Forms
        this.transactionForm = document.getElementById('transaction-form');
        this.budgetForm = document.getElementById('budget-form');
        this.categoryForm = document.getElementById('category-form');

        // Lists
        this.fullTransactionList = document.getElementById('full-transaction-list');
        this.categoryListEl = document.getElementById('category-list');
        this.transactionList = document.getElementById('recent-transaction-list'); // May be null

        // Form Elements
        this.modalTitle = this.expenseModal.querySelector('h2');
        this.submitBtn = this.transactionForm.querySelector('.btn-submit');
        this.categoryModalTitle = document.getElementById('category-modal-title');
        this.categorySubmitBtn = document.getElementById('category-submit-btn');

        // Navigation & Filtering
        this.navLinks = document.querySelectorAll('.nav-link');
        this.views = document.querySelectorAll('.view');
        this.viewAllBtn = document.getElementById('view-all-transactions');
        this.monthSelector = document.getElementById('global-month-selector');
        this.searchField = document.getElementById('transaction-search');
        this.filterCategory = document.getElementById('filter-category');
        this.filterType = document.getElementById('filter-type');
        this.exportCsvBtn = document.getElementById('export-csv');
        this.exportPdfBtn = document.getElementById('export-pdf');

        // Stat Elements
        this.totalIncomeEl = document.getElementById('total-income');
        this.totalBudgetEl = document.getElementById('total-budget');
        this.totalSpentEl = document.getElementById('total-spent');
        this.debtBalanceEl = document.getElementById('debt-balance');
        this.cashInHandEl = document.getElementById('cash-in-hand');
        this.spentPercentageEl = document.getElementById('spent-percentage');
        this.debtStatusEl = document.getElementById('debt-status');
        this.budgetCard = document.getElementById('budget-card');

        // Extended Analytics Elements
        this.statDailyAvgEl = document.getElementById('stat-daily-avg');
        this.statForecastEl = document.getElementById('stat-forecast');
        this.statPeakDayEl = document.getElementById('stat-peak-day');
        this.statPeakAmountEl = document.getElementById('stat-peak-amount');
        this.statPacePercentEl = document.getElementById('stat-pace-percent');
        this.statPaceMsgEl = document.getElementById('stat-pace-msg');
        this.topCategoriesListEl = document.getElementById('top-categories-list');
        this.efficiencyFillEl = document.getElementById('efficiency-fill');
        this.efficiencyPercentEl = document.getElementById('efficiency-percent');
        this.efficiencyMsgEl = document.getElementById('efficiency-msg');
        this.aiRecommendsListEl = document.getElementById('ai-recommends-list');
        this.trendPeriodEl = document.getElementById('trend-period');
        this.smartPersonSelector = document.getElementById('smart-person-selector');
        this.sortByEl = document.getElementById('sort-by');
        this.clearAuditBtn = document.getElementById('clear-audit-btn');

        // Calendar Elements
        this.calendarGridEl = document.getElementById('calendar-grid');
        this.dayDetailModal = document.getElementById('day-detail-modal');
        this.dayTransactionsListEl = document.getElementById('day-transactions-list');
        this.detailDateTitle = document.getElementById('detail-date-title');
        this.closeDetailBtn = document.querySelector('.close-detail');

        // Debt Vault Elements
        this.debtPersonListEl = document.getElementById('debt-person-list');
        this.personFieldGroup = document.getElementById('person-group');
        this.dueDateGroup = document.getElementById('due-date-group');
        this.dueDateField = document.getElementById('due-date');
        this.personInput = document.getElementById('person');
    }

    bindEvents() {
        // Sidebar Navigation
        this.navLinks.forEach(link => link.addEventListener('click', (e) => {
            e.preventDefault();
            this.switchView(link.id.replace('nav-', ''));
        }));

        if (this.viewAllBtn) {
            this.viewAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView('transactions');
            });
        }

        // Export Events
        this.exportCsvBtn.addEventListener('click', () => this.exportToCSV());
        this.exportPdfBtn.addEventListener('click', () => this.exportToPDF());

        // Global Filters
        this.monthSelector.addEventListener('change', () => this.updateUI());

        // Load settings
        this.loadSettings();

        [this.searchField, this.filterCategory, this.filterType].forEach(el => {
            if (el) el.addEventListener('input', () => this.renderFullTransactions());
        });

        // Trend Period Listener
        if (this.trendPeriodEl) {
            this.trendPeriodEl.addEventListener('change', () => this.updateUI());
        }
        if (this.sortByEl) {
            this.sortByEl.addEventListener('change', () => this.renderFullTransactions());
        }

        // Smart Calculator Listener
        const amountInput = document.getElementById('amount');
        const calcResult = document.getElementById('calc-result');
        amountInput.addEventListener('input', (e) => {
            const val = e.target.value;
            if (/[+\-*/]/.test(val)) {
                try {
                    // Safe evaluation of simple math
                    const result = Function(`'use strict'; return (${val})`)();
                    if (!isNaN(result) && isFinite(result)) {
                        calcResult.textContent = `= ${this.formatCurrency(result)}`;
                    } else {
                        calcResult.textContent = '';
                    }
                } catch {
                    calcResult.textContent = '';
                }
            } else {
                calcResult.textContent = '';
            }
        });

        // Icon Picker Events
        document.getElementById('open-icon-picker').addEventListener('click', () => this.toggleModal(document.getElementById('icon-picker-modal'), true));
        document.getElementById('close-icon-picker').addEventListener('click', () => this.toggleModal(document.getElementById('icon-picker-modal'), false));
        document.getElementById('icon-search').addEventListener('input', (e) => this.renderIconPicker(e.target.value));

        // Modal Toggles
        this.addExpenseBtn.addEventListener('click', () => {
            this.editingId = null;
            this.modalTitle.textContent = 'Add New Transaction';
            this.submitBtn.textContent = 'Add Transaction';
            this.transactionForm.reset();
            this.toggleModal(this.expenseModal, true);
        });

        this.addCategoryBtn.addEventListener('click', () => {
            this.editingCategoryId = null;
            this.categoryModalTitle.textContent = 'Add New Category';
            this.categorySubmitBtn.textContent = 'Add Category';
            this.categoryForm.reset();
            this.toggleModal(this.categoryModal, true);
        });

        this.closeModalBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.toggleModal(this.expenseModal, false);
                this.toggleModal(this.budgetModal, false);
                this.toggleModal(this.categoryModal, false);
            });
        });

        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.toggleModal(e.target, false);
            }
        });

        // Form Submissions
        this.transactionForm.addEventListener('submit', (e) => this.handleAddTransaction(e));
        this.budgetForm.addEventListener('submit', (e) => this.handleSetBudget(e));
        this.categoryForm.addEventListener('submit', (e) => this.handleCategorySubmit(e));

        this.budgetCard.addEventListener('click', () => this.toggleModal(this.budgetModal, true));

        if (this.clearAuditBtn) {
            this.clearAuditBtn.addEventListener('click', () => {
                this.confirmDialog('Are you sure you want to clear the entire audit log?', 'trash-2').then(ok => {
                    if (ok) {
                        this.auditLog = [];
                        localStorage.setItem('auditLog', JSON.stringify(this.auditLog));
                        this.renderAuditLog();
                        this.showToast('Audit log cleared.', 'info');
                    }
                });
            });
        }

        if (this.closeDetailBtn) {
            this.closeDetailBtn.addEventListener('click', () => {
                this.dayDetailModal.style.display = 'none';
            });
        }

        if (this.dayDetailModal) {
            this.dayDetailModal.addEventListener('click', (e) => {
                if (e.target === this.dayDetailModal) this.dayDetailModal.style.display = 'none';
            });
        }

        // Type Change Listener (to show/hide Person field)
        document.getElementById('type').addEventListener('change', (e) => {
            const val = e.target.value;
            const needsPerson = ['Lend', 'Repay', 'Borrow', 'Payback'].includes(val);
            this.personFieldGroup.style.display = needsPerson ? 'block' : 'none';
            this.dueDateGroup.style.display = (val === 'Lend' || val === 'Borrow') ? 'block' : 'none';

            // Smart Person Selector for debt settlement
            if (['Repay', 'Payback'].includes(val)) {
                this.updateSmartPersonSuggestions(val);
            } else {
                if (this.smartPersonSelector) this.smartPersonSelector.innerHTML = '';
            }
        });
    }

    updateSmartPersonSuggestions(type) {
        if (!this.smartPersonSelector) return;

        // Analyze debt vault to find active people
        const peopleMap = {};
        this.transactions.forEach(t => {
            if (['Lend', 'Repay', 'Borrow', 'Payback'].includes(t.type) && t.person) {
                const amount = t.amount;
                if (!peopleMap[t.person]) peopleMap[t.person] = 0;

                if (t.type === 'Lend') peopleMap[t.person] += amount;
                else if (t.type === 'Repay') peopleMap[t.person] -= amount;
                else if (t.type === 'Borrow') peopleMap[t.person] -= amount;
                else if (t.type === 'Payback') peopleMap[t.person] += amount;
            }
        });

        // Filter for people with non-zero balance
        const activePeople = Object.entries(peopleMap)
            .filter(([name, bal]) => Math.abs(bal) > 0)
            .map(([name, bal]) => ({ name, balance: bal }));

        if (activePeople.length === 0) {
            this.smartPersonSelector.innerHTML = '';
            return;
        }

        this.smartPersonSelector.innerHTML = activePeople.map(p => `
            <div class="smart-chip" onclick="document.getElementById('person').value = '${p.name.replace(/'/g, "\\'")}'; this.parentElement.innerHTML=''">
                <i data-lucide="user"></i>
                <span>${p.name} (${this.formatCurrency(Math.abs(p.balance))})</span>
            </div>
        `).join('');

        if (window.lucide) lucide.createIcons();
    }

    // --- Core Logic & Data ---

    getFilteredTransactions(forMonthOnly = false) {
        const selectedPeriod = this.monthSelector.value;
        const [selMonth, selYear] = selectedPeriod.split(' ');
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const selMonthIdx = monthNames.indexOf(selMonth);

        // 1. Filter by Month
        let filtered = this.transactions.filter(t => {
            const tDate = new Date(t.date);
            return tDate.getMonth() === selMonthIdx && tDate.getFullYear() === parseInt(selYear);
        });

        // 2. Filter by Search/Category/Type (only for full list)
        if (!forMonthOnly) {
            const search = (this.searchField?.value || '').toLowerCase();
            const cat = this.filterCategory?.value || 'all';
            const type = this.filterType?.value || 'all';
            const sort = this.sortByEl?.value || 'date-desc';

            filtered = filtered.filter(t => {
                const matchesSearch = !search ||
                    (t.note && t.note.toLowerCase().includes(search)) ||
                    t.category.toLowerCase().includes(search);
                const matchesCat = cat === 'all' || t.category === cat;
                const matchesType = type === 'all' || t.type === type;
                return matchesSearch && matchesCat && matchesType;
            });

            // 3. Apply Sorting
            filtered.sort((a, b) => {
                if (sort === 'date-desc') return new Date(b.date) - new Date(a.date);
                if (sort === 'date-asc') return new Date(a.date) - new Date(b.date);
                if (sort === 'amount-desc') return b.amount - a.amount;
                if (sort === 'amount-asc') return a.amount - b.amount;
                return 0;
            });
        }

        return filtered;
    }

    updateUI() {
        this.updatePeriodSelector();
        const monthlyData = this.getFilteredTransactions(true);

        // Dynamic Greeting
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
        document.getElementById('user-greeting').textContent = `${greeting}, Mr Hacker!`;
        document.getElementById('current-date-display').textContent = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });

        // Calculations
        const totalIncome = monthlyData.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
        const totalSpent = monthlyData.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
        const totalLent = monthlyData.filter(t => t.type === 'Lend').reduce((s, t) => s + t.amount, 0);
        const totalRepaid = monthlyData.filter(t => t.type === 'Repay').reduce((s, t) => s + t.amount, 0);
        const totalBorrowed = monthlyData.filter(t => t.type === 'Borrow').reduce((s, t) => s + t.amount, 0);
        const totalPaidback = monthlyData.filter(t => t.type === 'Payback').reduce((s, t) => s + t.amount, 0);

        const netLent = totalLent - totalRepaid;
        const netBorrowed = totalBorrowed - totalPaidback;
        const totalDebtBalance = netLent - netBorrowed; // Positive means you are owed, negative means you owe

        // Cash In Hand Calculation (Actual liquidity)
        // Cash = (Income + Borrow + Repay) - (Expense + Lend + Payback)
        const cashInHand = (totalIncome + totalBorrowed + totalRepaid) - (totalSpent + totalLent + totalPaidback);

        const spentPercent = this.budget > 0 ? (totalSpent / this.budget) * 100 : 0;

        // Display Stats
        if (this.cashInHandEl) this.cashInHandEl.textContent = this.formatCurrency(cashInHand);
        this.totalIncomeEl.textContent = this.formatCurrency(totalIncome);
        this.totalBudgetEl.textContent = this.formatCurrency(this.budget);
        this.totalSpentEl.textContent = this.formatCurrency(totalSpent);
        this.debtBalanceEl.textContent = this.formatCurrency(Math.abs(totalDebtBalance));
        this.spentPercentageEl.textContent = `${spentPercent.toFixed(1)}% of budget`;

        // Smart Budget Alerts
        if (this.budget > 0) {
            if (spentPercent >= 100) {
                this.showToast('🚨 Budget Exceeded! You have spent more than your monthly limit.', 'error');
                this.budgetCard.classList.add('over-budget');
            } else if (spentPercent >= 80) {
                this.showToast(`⚠️ Budget Warning: You have used ${spentPercent.toFixed(0)}% of your budget.`, 'info');
                this.budgetCard.classList.remove('over-budget');
            } else {
                this.budgetCard.classList.remove('over-budget');
            }
        }

        if (totalDebtBalance > 0) {
            this.debtStatusEl.textContent = 'People Owe You';
            this.debtStatusEl.className = 'stat-change positive';
        } else if (totalDebtBalance < 0) {
            this.debtStatusEl.textContent = 'You Owe People';
            this.debtStatusEl.className = 'stat-change negative';
        } else {
            this.debtStatusEl.textContent = 'All Settled';
            this.debtStatusEl.className = 'stat-change neutral';
        }

        // Update Lists & Charts
        this.renderTransactions();
        this.renderFullTransactions();
        this.updateCharts(monthlyData);
        this.renderExtendedAnalytics(monthlyData);

        if (window.lucide) lucide.createIcons();
    }

    // --- Views & Rendering ---

    switchView(viewName) {
        this.navLinks.forEach(link => link.classList.toggle('active', link.id === `nav-${viewName}`));
        this.views.forEach(view => view.classList.toggle('active', view.id === `view-${viewName}`));

        // Mobile Tab Support
        document.querySelectorAll('.mobile-tab').forEach(tab => {
            const isMatch = tab.getAttribute('onclick').includes(`'${viewName}'`);
            tab.classList.toggle('active', isMatch);
        });

        // Update Header Title
        const titles = {
            dashboard: 'Financial Dashboard',
            transactions: 'Transaction Vault',
            categories: 'Category Management',
            analytics: 'Financial Intelligence',
            debt: 'Debt Vault',
            audit: 'Audit Vault',
            calendar: 'Calendar Vault',
            settings: 'System Settings'
        };
        document.getElementById('active-view-title').textContent = titles[viewName] || 'SpendWise';

        if (viewName === 'transactions') this.renderFullTransactions();
        if (viewName === 'categories') this.renderCategories();
        if (viewName === 'debt') this.renderDebtVault();
        if (viewName === 'audit') this.renderAuditLog();
        if (viewName === 'calendar') this.renderCalendar();
    }

    renderTransactions() {
        if (!this.transactionList) return;
        const transactions = this.getFilteredTransactions(true).slice(0, 10);

        if (transactions.length === 0) {
            this.transactionList.innerHTML = '<div class="empty-state"><p>No records for this month.</p></div>';
            return;
        }

        this.transactionList.innerHTML = transactions.map(t => this.createTransactionHTML(t)).join('');
    }

    renderFullTransactions() {
        const list = document.getElementById('full-transaction-list');
        const countEl = document.getElementById('transaction-count');
        const filtered = this.getFilteredTransactions();

        if (countEl) countEl.textContent = `Found ${filtered.length} records`;

        if (filtered.length === 0) {
            this.fullTransactionList.innerHTML = '<div class="empty-state"><p>No matching transactions found.</p></div>';
            return;
        }

        this.fullTransactionList.innerHTML = filtered.map(t => this.createTransactionHTML(t)).join('');
        if (window.lucide) lucide.createIcons();
    }

    createTransactionHTML(t) {
        const cat = this.categories[t.category] || this.categories.Other;
        const isOut = ['Expense', 'Lend', 'Payback'].includes(t.type);
        const personTag = t.person ? `<span class="person-tag"><i data-lucide="user"></i> ${t.person}</span>` : '';

        return `
            <div class="transaction-item">
                <div class="item-left">
                    <div class="item-icon" style="background: ${cat.color}20; color: ${cat.color}">
                        <i data-lucide="${cat.icon}"></i>
                    </div>
                    <div class="item-info">
                        <h4>${t.note || t.category} ${personTag}</h4>
                        <p>${new Date(t.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })} • ${t.type}</p>
                    </div>
                </div>
                <div class="item-right">
                    <div class="item-actions">
                        <button class="action-btn edit" onclick="app.editTransaction(${t.id})"><i data-lucide="edit-3"></i></button>
                        <button class="action-btn delete" onclick="app.deleteTransaction(${t.id})"><i data-lucide="trash-2"></i></button>
                    </div>
                    <p class="item-amount ${isOut ? 'negative' : 'positive'}">${isOut ? '-' : '+'}${this.formatCurrency(t.amount)}</p>
                </div>
            </div>
        `;
    }

    renderCategories() {
        this.categoryListEl.innerHTML = Object.entries(this.categories).map(([name, data]) => `
            <div class="category-item glass">
                <div class="cat-actions">
                    <button class="action-btn edit" onclick="app.editCategory('${name}')"><i data-lucide="edit-3"></i></button>
                    <button class="action-btn delete" onclick="app.deleteCategory('${name}')"><i data-lucide="trash-2"></i></button>
                </div>
                <div class="cat-icon-large" style="background: ${data.color}20; color: ${data.color}">
                    <i data-lucide="${data.icon}"></i>
                </div>
                <div class="cat-info"><h3>${name}</h3></div>
            </div>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }

    // --- Charting ---

    initCharts() {
        const trendsCtx = document.getElementById('trendsChart').getContext('2d');
        const categoryCtx = document.getElementById('categoryChart').getContext('2d');

        // Create gradients
        const incomeGradient = trendsCtx.createLinearGradient(0, 0, 0, 400);
        incomeGradient.addColorStop(0, 'rgba(0, 255, 136, 0.2)');
        incomeGradient.addColorStop(1, 'rgba(0, 255, 136, 0)');

        const expenseGradient = trendsCtx.createLinearGradient(0, 0, 0, 400);
        expenseGradient.addColorStop(0, 'rgba(255, 77, 109, 0.2)');
        expenseGradient.addColorStop(1, 'rgba(255, 77, 109, 0)');

        this.trendsChart = new Chart(trendsCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        type: 'bar',
                        label: 'Income',
                        data: [],
                        backgroundColor: '#10b981',
                        borderRadius: 20,
                        barThickness: 12,
                        order: 2
                    },
                    {
                        type: 'line',
                        label: 'Expense',
                        data: [],
                        borderColor: '#f43f5e',
                        backgroundColor: expenseGradient,
                        fill: true,
                        tension: 0.45,
                        borderWidth: 4,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#f43f5e',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 20,
                            color: '#64748b',
                            font: { size: 11, weight: '700' }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        padding: 15,
                        titleFont: { size: 14, weight: '800' },
                        bodyFont: { size: 13 },
                        cornerRadius: 12,
                        boxPadding: 8
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false },
                        ticks: { color: '#94a3b8', font: { size: 11 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 11 } }
                    }
                }
            }
        });

        this.categoryChart = new Chart(categoryCtx, {
            type: 'polarArea',
            data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: '#fff' }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        ticks: { display: false },
                        grid: { color: 'rgba(0,0,0,0.03)' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'rectRounded',
                            padding: 12,
                            color: '#64748b',
                            font: { size: 10, weight: '600' }
                        }
                    }
                }
            }
        });
    }

    updateCharts(data) {
        if (!this.trendsChart || !this.categoryChart) return;

        // 1. Category Chart (Keep as is)
        const catMap = {};
        data.filter(t => t.type === 'Expense').forEach(t => catMap[t.category] = (catMap[t.category] || 0) + t.amount);

        this.categoryChart.data.labels = Object.keys(catMap);
        this.categoryChart.data.datasets[0].data = Object.values(catMap);
        this.categoryChart.data.datasets[0].backgroundColor = Object.keys(catMap).map(c => this.categories[c]?.color || '#94a3b8');
        this.categoryChart.update();

        // 2. Trends Chart (Daily vs Weekly)
        const periodType = this.trendPeriodEl ? this.trendPeriodEl.value : 'month';
        const selectedPeriod = this.monthSelector.value;
        const [monthName, year] = selectedPeriod.split(' ');
        const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();

        let labels = [];
        let incomeData = [];
        let expenseData = [];

        if (periodType === 'month') {
            const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = new Date(year, monthIndex, day).toDateString();
                const dayTransactions = data.filter(t => new Date(t.date).toDateString() === dateStr);

                labels.push(day);
                incomeData.push(dayTransactions.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0));
                expenseData.push(dayTransactions.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0));
            }
        } else {
            // Weekly Grouping
            labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
            incomeData = [0, 0, 0, 0, 0];
            expenseData = [0, 0, 0, 0, 0];

            data.forEach(t => {
                const day = new Date(t.date).getDate();
                const weekIdx = Math.min(4, Math.floor((day - 1) / 7));
                if (t.type === 'Income') incomeData[weekIdx] += t.amount;
                if (t.type === 'Expense') expenseData[weekIdx] += t.amount;
            });

            // Trim Week 5 if no data
            if (incomeData[4] === 0 && expenseData[4] === 0) {
                labels.pop(); incomeData.pop(); expenseData.pop();
            }
        }

        this.trendsChart.data.labels = labels;
        this.trendsChart.data.datasets[0].data = incomeData;
        this.trendsChart.data.datasets[1].data = expenseData;
        this.trendsChart.update();

        // 3. Extended Analytics (if in view)
        this.renderExtendedAnalytics(data);
    }

    // --- Helper Methods ---

    updatePeriodSelector() {
        const months = [];
        this.transactions.forEach(t => {
            const period = new Date(t.date).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
            if (!months.includes(period)) months.push(period);
        });

        const currentPeriod = new Date().toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
        if (!months.includes(currentPeriod)) months.unshift(currentPeriod);

        const currentSelection = this.monthSelector.value;
        this.monthSelector.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');
        if (currentSelection && months.includes(currentSelection)) this.monthSelector.value = currentSelection;
        else this.monthSelector.value = currentPeriod;
    }

    updateTransactionFormCategories() {
        const catSelect = document.getElementById('category');
        const filterSelect = document.getElementById('filter-category');

        const options = Object.keys(this.categories).map(name => `<option value="${name}">${name}</option>`).join('');

        if (catSelect) catSelect.innerHTML = options;
        if (filterSelect) {
            const currentFilter = filterSelect.value;
            filterSelect.innerHTML = '<option value="all">All Categories</option>' + options;
            filterSelect.value = currentFilter || 'all';
        }
    }

    toggleModal(modal, show) {
        modal.style.display = show ? 'flex' : 'none';
        if (show && modal === this.expenseModal && !this.editingId) document.getElementById('date').valueAsDate = new Date();
    }

    handleAddTransaction(e) {
        e.preventDefault();

        let amountVal = document.getElementById('amount').value;
        try {
            if (/[+\-*/]/.test(amountVal)) {
                amountVal = Function(`'use strict'; return (${amountVal})`)();
            } else {
                amountVal = parseFloat(amountVal);
            }
        } catch {
            amountVal = parseFloat(amountVal);
        }

        const t = {
            id: null, // Will be set below
            type: document.getElementById('type').value,
            amount: amountVal,
            category: document.getElementById('category').value,
            date: document.getElementById('date').value,
            note: document.getElementById('note').value,
            person: document.getElementById('person').value,
            dueDate: document.getElementById('due-date').value
        };

        if (this.editingId) {
            t.id = this.editingId;
            const index = this.transactions.findIndex(item => item.id === this.editingId);
            if (index !== -1) {
                const old = this.transactions[index];
                this.logAction('EDIT', `Transaction #${t.id}`, `Updated record.`, {
                    from: `${this.formatCurrency(old.amount)} (${old.type})`,
                    to: `${this.formatCurrency(t.amount)} (${t.type})`
                });
                this.transactions[index] = t;
            }
            this.showToast('Transaction updated!', 'success');
        } else {
            // STRICT SEQUENTIAL ID
            this.reindexTransactions(); // Ensure existing sequence is clean
            this.lastTransactionId++;
            t.id = this.lastTransactionId;
            
            this.transactions.unshift(t);
            this.logAction('CREATE', `Transaction #${t.id}`, `Added ${t.type} of ${this.formatCurrency(t.amount)}.`);
            this.showToast('Transaction added!', 'success');
        }

        this.saveAndRefresh();
        this.toggleModal(this.expenseModal, false);
    }

    handleCategorySubmit(e) {
        e.preventDefault();
        const name = document.getElementById('cat-name').value;
        const icon = document.getElementById('cat-icon').value;
        const color = document.getElementById('cat-color').value;

        if (this.editingCategoryId && this.editingCategoryId !== name) {
            // Update all transactions using the old category name
            this.transactions.forEach(t => {
                if (t.category === this.editingCategoryId) t.category = name;
            });
            this.logAction('EDIT', `Category: ${this.editingCategoryId}`, `Renamed to "${name}". All associated transactions updated.`);
            delete this.categories[this.editingCategoryId];
            localStorage.setItem('transactions', JSON.stringify(this.transactions));
        } else if (!this.editingCategoryId && !this.categories[name]) {
            this.logAction('CREATE', `Category: ${name}`, `Created new category.`);
        }

        this.categories[name] = { icon, color };

        localStorage.setItem('categories', JSON.stringify(this.categories));
        this.renderCategories();
        this.updateTransactionFormCategories();
        this.updateUI();
        this.toggleModal(this.categoryModal, false);
        this.showToast(`Category "${name}" saved!`, 'success');
    }

    handleSetBudget(e) {
        e.preventDefault();
        this.budget = parseFloat(document.getElementById('budget-amount').value);
        localStorage.setItem('monthlyBudget', this.budget);
        this.updateUI();
        this.toggleModal(this.budgetModal, false);
    }

    editTransaction(id) {
        const t = this.transactions.find(item => item.id === id);
        if (!t) return;
        this.editingId = id;
        this.modalTitle.textContent = 'Edit Transaction';
        document.getElementById('type').value = t.type;
        document.getElementById('amount').value = t.amount;
        document.getElementById('category').value = t.category;
        document.getElementById('date').value = t.date;
        document.getElementById('note').value = t.note;
        document.getElementById('person').value = t.person || '';
        document.getElementById('due-date').value = t.dueDate || '';

        // Show person field if needed
        const type = t.type;
        const needsPerson = ['Lend', 'Repay', 'Borrow', 'Payback'].includes(type);
        this.personFieldGroup.style.display = needsPerson ? 'block' : 'none';
        this.dueDateGroup.style.display = (type === 'Lend' || type === 'Borrow') ? 'block' : 'none';

        this.toggleModal(this.expenseModal, true);
    }

    deleteTransaction(id) {
        this.confirmDialog('Are you sure you want to delete this transaction?').then(ok => {
            if (ok) {
                const t = this.transactions.find(item => item.id === id);
                if (t) this.logAction('DELETE', `Transaction #${t.id}: ${t.note || t.category}`, `Removed ${t.type} of ${this.formatCurrency(t.amount)}.`);
                this.transactions = this.transactions.filter(t => t.id !== id);
                this.saveAndRefresh();
                this.showToast('Transaction deleted.', 'info');
            }
        });
    }

    migrateIds() {
        if (this.transactions.length === 0) {
            if (this.lastTransactionId === 0) {
                this.lastTransactionId = 0;
                localStorage.setItem('lastTransactionId', 0);
            }
            return;
        }

        // Check if migration is needed (IDs > 1,000,000,000 are timestamps)
        const needsMigration = this.transactions.some(t => t.id > 1000000000);

        if (needsMigration) {
            // Sort by date ascending to assign IDs chronologically
            this.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

            this.transactions.forEach((t, index) => {
                t.id = index + 1;
            });

            this.lastTransactionId = this.transactions.length;
            localStorage.setItem('lastTransactionId', this.lastTransactionId);

            // Re-sort descending for the UI
            this.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
            this.saveAndRefresh();
        }
    }

    editCategory(name) {
        const cat = this.categories[name];
        if (!cat) return;

        this.editingCategoryId = name;
        this.categoryModalTitle.textContent = 'Edit Category';
        this.categorySubmitBtn.textContent = 'Update Category';

        document.getElementById('cat-name').value = name;
        document.getElementById('cat-icon').value = cat.icon;
        document.getElementById('cat-color').value = cat.color;

        this.toggleModal(this.categoryModal, true);
    }

    deleteCategory(name) {
        // Prevent deleting categories that are in use
        const inUse = this.transactions.some(t => t.category === name);
        if (inUse) {
            this.showToast(`Cannot delete "${name}" because it is in use.`, 'error');
            return;
        }

        this.confirmDialog(`Are you sure you want to delete the category "${name}"?`, 'trash-2').then(ok => {
            if (ok) {
                this.logAction('DELETE', `Category: ${name}`, `Category removed.`);
                delete this.categories[name];
                localStorage.setItem('categories', JSON.stringify(this.categories));
                this.renderCategories();
                this.updateTransactionFormCategories();
                this.showToast(`Category "${name}" removed.`, 'info');
            }
        });
    }

    saveAndRefresh() {
        localStorage.setItem('transactions', JSON.stringify(this.transactions));
        this.updateUI();
    }

    confirmDialog(message, icon = 'help-circle') {
        return new Promise(resolve => {
            const modal = document.getElementById('confirm-modal');
            const messageEl = document.getElementById('confirm-message');
            const iconEl = document.getElementById('confirm-type-icon');

            if (messageEl) messageEl.textContent = message;
            if (iconEl) {
                iconEl.setAttribute('data-lucide', icon);
                if (window.lucide) lucide.createIcons();
            }

            modal.style.display = 'flex';
            const cleanup = (res) => {
                modal.style.display = 'none';
                document.getElementById('confirm-ok').onclick = null;
                document.getElementById('confirm-cancel').onclick = null;
                resolve(res);
            };
            document.getElementById('confirm-ok').onclick = () => cleanup(true);
            document.getElementById('confirm-cancel').onclick = () => cleanup(false);
        });
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', minimumFractionDigits: 0 }).format(amount);
    }

    // --- Export Logic ---

    exportToCSV() {
        const data = this.getFilteredTransactions();
        if (data.length === 0) return this.showToast('No data to export!', 'error');

        const headers = ['Date', 'Type', 'Category', 'Amount (PKR)', 'Note'];
        const csvRows = [headers.join(',')];

        data.forEach(t => {
            const row = [
                t.date,
                t.type,
                t.category,
                t.amount,
                `"${(t.note || '').replace(/"/g, '""')}"`
            ];
            csvRows.push(row.join(','));
        });

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `SpendWise_Report_${this.monthSelector.value}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async exportToPDF() {
        const { jsPDF } = window.jspdf;
        const data = this.getFilteredTransactions();
        if (data.length === 0) return this.showToast('No data to export!', 'error');

        const doc = new jsPDF();
        const period = this.monthSelector.value;

        // Header
        doc.setFontSize(22);
        doc.setTextColor(0, 229, 255); // Cyan
        doc.text('SpendWise Financial Report', 14, 20);

        doc.setFontSize(12);
        doc.setTextColor(100);
        doc.text(`Period: ${period}`, 14, 30);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 38);

        // Summary Box
        const monthlyData = this.getFilteredTransactions(true);
        const income = monthlyData.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
        const expense = monthlyData.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);

        doc.setDrawColor(200);
        doc.line(14, 45, 196, 45);

        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text('Monthly Summary', 14, 55);

        doc.setFontSize(11);
        doc.text(`Total Income: ${this.formatCurrency(income)}`, 14, 65);
        doc.text(`Total Expenses: ${this.formatCurrency(expense)}`, 14, 72);
        doc.text(`Net Savings: ${this.formatCurrency(income - expense)}`, 14, 79);

        // Table
        const tableData = data.map(t => [
            t.date,
            t.type,
            t.category,
            this.formatCurrency(t.amount),
            t.note || '-'
        ]);

        doc.autoTable({
            startY: 90,
            head: [['Date', 'Type', 'Category', 'Amount', 'Note']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [112, 0, 255] }, // Purple
            alternateRowStyles: { fillColor: [245, 245, 255] }
        });

        doc.save(`SpendWise_Report_${period}.pdf`);
    }
    // --- New Features Logic ---

    renderExtendedAnalytics(data) {
        const totalSpent = data.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);

        // 1. Daily Average
        const selectedPeriod = this.monthSelector.value;
        const [monthName, year] = selectedPeriod.split(' ');
        const now = new Date();
        const isCurrentMonth = selectedPeriod === now.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });

        const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const daysPassed = isCurrentMonth ? now.getDate() : daysInMonth;

        const dailyAvg = totalSpent / daysPassed;
        this.statDailyAvgEl.textContent = this.formatCurrency(dailyAvg);

        // 2. Monthly Forecast
        const forecast = dailyAvg * daysInMonth;
        this.statForecastEl.textContent = this.formatCurrency(forecast);

        // 3. Peak Spending Day
        const dailyTotals = {};
        data.filter(t => t.type === 'Expense').forEach(t => dailyTotals[t.date] = (dailyTotals[t.date] || 0) + t.amount);

        const peakDate = Object.keys(dailyTotals).reduce((a, b) => dailyTotals[a] > dailyTotals[b] ? a : b, null);
        if (peakDate) {
            const dateObj = new Date(peakDate);
            this.statPeakDayEl.textContent = dateObj.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric' });
            this.statPeakAmountEl.textContent = this.formatCurrency(dailyTotals[peakDate]);
        } else {
            this.statPeakDayEl.textContent = 'No data';
            this.statPeakAmountEl.textContent = 'PKR 0';
        }

        // 4. Savings Efficiency
        const totalIncome = data.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
        const savings = totalIncome - totalSpent;
        const efficiency = totalIncome > 0 ? Math.max(0, (savings / totalIncome) * 100) : 0;

        if (this.efficiencyFillEl) {
            this.efficiencyFillEl.style.strokeDasharray = `${efficiency}, 100`;
            this.efficiencyPercentEl.textContent = `${efficiency.toFixed(0)}%`;

            let msg = "Keep it up!";
            if (efficiency >= 50) msg = "Excellent! High savings rate.";
            else if (efficiency >= 20) msg = "Great job! On track.";
            else if (efficiency <= 0 && totalIncome > 0) msg = "Alert: Overspending income.";
            this.efficiencyMsgEl.textContent = msg;
        }

        // 5. Top Categories with Trend comparison
        if (this.topCategoriesListEl) {
            const currentMonthData = data.filter(t => t.type === 'Expense');

            // Get last month data for comparison
            const [monthName, year] = this.monthSelector.value.split(' ');
            const date = new Date(`${monthName} 1, ${year}`);
            date.setMonth(date.getMonth() - 1);
            const prevMonthName = date.toLocaleString('default', { month: 'long' });
            const prevYear = date.getFullYear();
            const prevMonthKey = `${prevMonthName} ${prevYear}`;
            const prevMonthData = this.transactions.filter(t => {
                const tDate = new Date(t.date);
                const tMonth = tDate.toLocaleString('default', { month: 'long' });
                const tYear = tDate.getFullYear();
                return t.type === 'Expense' && `${tMonth} ${tYear}` === prevMonthKey;
            });

            const catMap = {};
            currentMonthData.forEach(t => catMap[t.category] = (catMap[t.category] || 0) + t.amount);

            const prevCatMap = {};
            prevMonthData.forEach(t => prevCatMap[t.category] = (prevCatMap[t.category] || 0) + t.amount);

            const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 4);
            const maxVal = sortedCats.length > 0 ? sortedCats[0][1] : 1;

            this.topCategoriesListEl.innerHTML = sortedCats.map(([name, amount]) => {
                const percent = (amount / maxVal) * 100;
                const cat = this.categories[name] || { color: '#94a3b8' };

                const prevAmount = prevCatMap[name] || 0;
                let trendHtml = '';
                if (prevAmount > 0) {
                    const diff = ((amount - prevAmount) / prevAmount) * 100;
                    const isUp = diff > 5; // 5% threshold
                    const isDown = diff < -5;
                    if (isUp) trendHtml = `<span class="cat-trend-indicator up"><i data-lucide="trending-up"></i> ${Math.abs(diff).toFixed(0)}%</span>`;
                    else if (isDown) trendHtml = `<span class="cat-trend-indicator down"><i data-lucide="trending-down"></i> ${Math.abs(diff).toFixed(0)}%</span>`;
                    else trendHtml = `<span class="cat-trend-indicator neutral">Stable</span>`;
                } else {
                    trendHtml = `<span class="cat-trend-indicator neutral">New</span>`;
                }

                return `
                    <div class="top-cat-item">
                        <div class="top-cat-info">
                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                <span>${name}</span>
                                ${trendHtml}
                            </div>
                            <span>${this.formatCurrency(amount)}</span>
                        </div>
                        <div class="top-cat-bar-bg">
                            <div class="top-cat-bar-fill" style="width: ${percent}%; background: ${cat.color}"></div>
                        </div>
                    </div>
                `;
            }).join('') || '<div class="empty-state">No expenses yet.</div>';
        }

        // 6. Weekly Pace (Compare current 7 days with previous 7 days)
        if (this.statPacePercentEl) {
            const today = new Date();
            const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);
            const fourteenDaysAgo = new Date(today); fourteenDaysAgo.setDate(today.getDate() - 14);

            const currWeekSpent = this.transactions
                .filter(t => t.type === 'Expense' && new Date(t.date) >= sevenDaysAgo && new Date(t.date) <= today)
                .reduce((s, t) => s + t.amount, 0);

            const prevWeekSpent = this.transactions
                .filter(t => t.type === 'Expense' && new Date(t.date) >= fourteenDaysAgo && new Date(t.date) < sevenDaysAgo)
                .reduce((s, t) => s + t.amount, 0);

            if (prevWeekSpent > 0) {
                const diffPercent = ((currWeekSpent - prevWeekSpent) / prevWeekSpent) * 100;
                const isFaster = diffPercent > 0;
                this.statPacePercentEl.textContent = `${Math.abs(diffPercent).toFixed(0)}%`;
                this.statPacePercentEl.style.color = isFaster ? '#ff4d6d' : '#00ff88';
                this.statPaceMsgEl.textContent = isFaster ? 'Spending faster than last week' : 'Slower than last week';
            } else {
                this.statPacePercentEl.textContent = '0%';
                this.statPaceMsgEl.textContent = 'Insufficient data';
            }
        }

        // 7. AI Reduction Suggestions
        this.generateAIInsights(data);
    }

    generateAIInsights(data) {
        if (!this.aiRecommendsListEl) return;

        const expenses = data.filter(t => t.type === 'Expense');
        const insights = [];

        // Analysis 1: Top Category Impact
        const catMap = {};
        expenses.forEach(t => catMap[t.category] = (catMap[t.category] || 0) + t.amount);
        const totalSpent = expenses.reduce((s, t) => s + t.amount, 0);

        const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
        if (sortedCats.length > 0) {
            const [topName, topAmount] = sortedCats[0];
            const ratio = (topAmount / totalSpent) * 100;

            if (ratio > 40) {
                insights.push({
                    title: `Dominant Category: ${topName}`,
                    message: `${topName} accounts for ${ratio.toFixed(0)}% of your spending. Reducing this by even 10% would save you ${this.formatCurrency(topAmount * 0.1)}.`,
                    type: 'warning',
                    icon: 'alert-circle'
                });
            }
        }

        // Analysis 2: Frequency Check (Death by 1000 cuts)
        const counts = {};
        expenses.forEach(t => counts[t.category] = (counts[t.category] || 0) + 1);
        const frequentCat = Object.entries(counts).find(([name, count]) => count > 10);
        if (frequentCat) {
            insights.push({
                title: `Frequent Spends: ${frequentCat[0]}`,
                message: `You've made ${frequentCat[1]} small transactions in ${frequentCat[0]} this month. Combining these or cutting impulsive buys could save significant cash.`,
                type: 'info',
                icon: 'zap'
            });
        }

        // Analysis 3: Trend vs Budget
        if (this.budget > 0 && totalSpent > this.budget * 0.8) {
            insights.push({
                title: "Budget Threshold Warning",
                message: `You are nearing your budget limit. Focus strictly on "Needs" for the rest of the month. Avoid any "Wants" until next month.`,
                type: 'warning',
                icon: 'trending-up'
            });
        }

        // Analysis 4: Savings Success
        const income = data.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
        const savingsRate = income > 0 ? ((income - totalSpent) / income) * 100 : 0;
        if (savingsRate > 20) {
            insights.push({
                title: "Healthy Savings Rate",
                message: `You're currently saving ${savingsRate.toFixed(0)}% of your income. This is above the recommended 20% mark. Well done!`,
                type: 'success',
                icon: 'shield-check'
            });
        }

        // Default if no insights
        if (insights.length === 0) {
            insights.push({
                title: "Steady Progress",
                message: "Your spending habits look stable so far. Keep monitoring your transactions to find more optimization opportunities.",
                type: 'info',
                icon: 'bar-chart'
            });
        }

        this.aiRecommendsListEl.innerHTML = insights.map(i => `
            <div class="ai-card glass ${i.type}">
                <div class="ai-card-header">
                    <i data-lucide="${i.icon}"></i>
                    <span>${i.title}</span>
                </div>
                <div class="ai-card-body">${i.message}</div>
                <div class="ai-action-text">STRATEGY: FOCUS HERE</div>
            </div>
        `).join('');

        if (window.lucide) lucide.createIcons();
    }

    renderDebtVault() {
        const debtMap = {};

        // Filter all debt-related transactions
        this.transactions.filter(t => ['Lend', 'Repay', 'Borrow', 'Payback'].includes(t.type)).forEach(t => {
            const person = t.person || 'Unknown';
            if (!debtMap[person]) debtMap[person] = { balance: 0, history: [] };

            // Positive for money you are owed, Negative for money you owe
            let impact = 0;
            if (t.type === 'Lend') impact = t.amount;
            if (t.type === 'Repay') impact = -t.amount;
            if (t.type === 'Borrow') impact = -t.amount;
            if (t.type === 'Payback') impact = t.amount;

            debtMap[person].balance += impact;
            debtMap[person].history.push(t);
        });

        const people = Object.entries(debtMap).sort((a, b) => Math.abs(b[1].balance) - Math.abs(a[1].balance));

        if (people.length === 0) {
            this.debtPersonListEl.innerHTML = '<div class="empty-state"><p>No active debts or lends found.</p></div>';
            return;
        }

        this.debtPersonListEl.innerHTML = people.map(([name, data]) => {
            const balance = data.balance;
            const statusClass = balance > 0 ? 'balance-lent' : balance < 0 ? 'balance-borrowed' : 'balance-settled';
            const statusText = balance > 0 ? 'They Owe You' : balance < 0 ? 'You Owe Them' : 'Settled';
            const avatar = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

            const recentHistory = data.history.slice(0, 3).map(h => {
                const isOverdue = h.dueDate && new Date(h.dueDate) < new Date() && balance !== 0;
                const dueText = h.dueDate ? `Due: ${new Date(h.dueDate).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })}` : '';

                return `
                    <div class="mini-item">
                        <div style="display:flex; flex-direction:column;">
                            <span>${new Date(h.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })} - ${h.type}</span>
                            ${dueText ? `<span class="due-badge ${isOverdue ? 'overdue' : ''}">${dueText}</span>` : ''}
                        </div>
                        <span class="amount">${this.formatCurrency(h.amount)}</span>
                    </div>
                `;
            }).join('');

            return `
                <div class="debt-person-card glass">
                    <div class="debt-card-header">
                        <div class="person-identity">
                            <div class="person-avatar">${avatar}</div>
                            <span class="person-name">${name}</span>
                        </div>
                        <div class="debt-balance-badge ${statusClass}">${statusText}</div>
                    </div>
                    <div class="stat-value" style="font-size: 1.5rem; margin-bottom: 1rem;">
                        ${this.formatCurrency(Math.abs(balance))}
                    </div>
                    <div class="debt-mini-history">
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 700;">RECENT ACTIVITY</p>
                        ${recentHistory}
                    </div>
                    ${balance !== 0 ? `
                        <button class="settle-btn" onclick="app.settleDebt('${name.replace(/'/g, "\\'")}', ${balance})">
                            <i data-lucide="check-circle"></i>
                            <span>Settle Full Balance</span>
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();
    }

    settleDebt(name, currentBalance) {
        const actionText = currentBalance > 0 ? `They are paying you back ${this.formatCurrency(currentBalance)}` : `You are paying back ${this.formatCurrency(Math.abs(currentBalance))}`;

        this.confirmDialog(`Confirm Settlement: ${actionText}?`, 'check-circle').then(ok => {
            if (ok) {
                const t = {
                    id: Date.now(),
                    type: currentBalance > 0 ? 'Repay' : 'Payback',
                    amount: Math.abs(currentBalance),
                    category: 'Debt',
                    date: new Date().toISOString().split('T')[0],
                    note: `Full Settlement with ${name}`,
                    person: name
                };

                this.transactions.unshift(t);
                this.logAction('CREATE', `Settlement with ${name}`, `Cleared full balance of ${this.formatCurrency(Math.abs(currentBalance))}.`);
                this.saveAndRefresh();
                this.renderDebtVault();
                this.showToast(`Settled with ${name}!`, 'success');
            }
        });
    }


    renderIconPicker(query = '') {
        const grid = document.getElementById('icon-grid');
        const commonIcons = [
            'home', 'utensils', 'car', 'shopping-cart', 'briefcase', 'gift',
            'heart', 'coffee', 'bus', 'plane', 'smartphone', 'laptop',
            'book', 'music', 'tv', 'gamepad', 'dumbbell', 'stethoscop',
            'droplets', 'zap', 'wifi', 'banknote', 'credit-card', 'wallet',
            'shopping-bag', 'package', 'truck', 'tool', 'hammer', 'wrench'
        ];

        const filtered = commonIcons.filter(icon => icon.includes(query.toLowerCase()));

        grid.innerHTML = filtered.map(icon => `
            <div class="icon-item-pick" onclick="app.selectIcon('${icon}')" title="${icon}">
                <i data-lucide="${icon}"></i>
            </div>
        `).join('');

        if (window.lucide) lucide.createIcons();
    }

    selectIcon(icon) {
        document.getElementById('cat-icon').value = icon;
        this.toggleModal(document.getElementById('icon-picker-modal'), false);
    }

    // --- Audit Log Logic ---

    logAction(action, target, message, diff = null) {
        const logEntry = {
            id: Date.now(),
            action, // CREATE, EDIT, DELETE
            target,
            message,
            diff,
            timestamp: new Date().toISOString()
        };
        this.auditLog.unshift(logEntry);
        // Keep only last 100 entries
        if (this.auditLog.length > 100) this.auditLog.pop();
        localStorage.setItem('auditLog', JSON.stringify(this.auditLog));
    }

    renderAuditLog() {
        if (!this.auditLogListEl) return;

        if (this.auditLog.length === 0) {
            this.auditLogListEl.innerHTML = '<div class="empty-state"><p>No activity recorded yet.</p></div>';
            return;
        }

        this.auditLogListEl.innerHTML = this.auditLog.map(log => {
            const typeClass = log.action.toLowerCase();
            const timeStr = new Date(log.timestamp).toLocaleString('en-PK', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });

            let diffHtml = '';
            if (log.diff) {
                diffHtml = `
                    <div class="audit-diff">
                        <div class="diff-line old">- ${log.diff.from}</div>
                        <div class="diff-line new">+ ${log.diff.to}</div>
                    </div>
                `;
            }

            return `
                <div class="audit-item">
                    <div class="audit-marker ${typeClass}"></div>
                    <div class="audit-info">
                        <div class="audit-header">
                            <span class="audit-action" style="color: var(--${typeClass === 'delete' ? 'accent-rose' : typeClass === 'edit' ? 'primary' : 'accent-emerald'})">${log.action}</span>
                            <span class="audit-time">${timeStr}</span>
                        </div>
                        <div class="audit-target">${log.target}</div>
                        <div class="audit-details">${log.message}</div>
                        ${diffHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderCalendar() {
        if (!this.calendarGridEl) return;

        const [monthName, year] = this.monthSelector.value.split(' ');
        const date = new Date(`${monthName} 1, ${year}`);
        const firstDayIndex = date.getDay();
        const daysInMonth = new Date(year, date.getMonth() + 1, 0).getDate();

        const monthData = this.getFilteredTransactions(true);
        let html = '';

        // Empty cells for previous month
        for (let i = 0; i < firstDayIndex; i++) {
            html += '<div class="calendar-day empty"></div>';
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayTransactions = monthData.filter(t => t.date === dateStr);

            const income = dayTransactions.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
            const expense = dayTransactions.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
            const net = income - expense;

            const isToday = new Date().toISOString().split('T')[0] === dateStr;
            const amountClass = net > 0 ? 'income' : net < 0 ? 'expense' : '';
            const amountText = net !== 0 ? this.formatCurrency(Math.abs(net)) : '';

            html += `
                <div class="calendar-day ${isToday ? 'today' : ''}" onclick="app.showDayDetail('${dateStr}')">
                    <span class="day-number">${day}</span>
                    ${net !== 0 ? `<span class="day-amount ${amountClass}">${net > 0 ? '+' : '-'}${amountText}</span>` : ''}
                    <div style="display:flex; gap:2px; flex-wrap:wrap;">
                        ${dayTransactions.slice(0, 3).map(t => `<div class="day-indicator" style="background: ${this.categories[t.category]?.color || '#94a3b8'}"></div>`).join('')}
                    </div>
                </div>
            `;
        }

        this.calendarGridEl.innerHTML = html;
        if (window.lucide) lucide.createIcons();
    }

    showDayDetail(dateStr) {
        const transactions = this.transactions.filter(t => t.date === dateStr);
        if (transactions.length === 0) return;

        this.detailDateTitle.textContent = new Date(dateStr).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });
        this.dayTransactionsListEl.innerHTML = transactions.map(t => this.createTransactionHTML(t)).join('');
        this.dayDetailModal.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    }

    // --- Command Center (Settings) Logic ---

    loadSettings() {
        if (!this.settings.theme) this.settings.theme = 'dark';
        this.applySettings();
    }

    setTheme(themeName) {
        this.settings.theme = themeName;
        localStorage.setItem('settings', JSON.stringify(this.settings));
        this.applySettings();
    }

    applySettings() {
        // Apply Profile
        const greeting = document.getElementById('user-greeting');
        const userName = document.querySelector('.user-name');
        const avatar = document.querySelector('.avatar');
        const settingsName = document.getElementById('settings-username');
        const profileName = document.getElementById('profile-name');

        if (greeting) greeting.textContent = `Good Morning, ${this.settings.username}!`;
        if (userName) userName.textContent = this.settings.username;
        if (avatar) avatar.textContent = this.settings.username.split(' ').map(n => n[0]).join('').toUpperCase();
        if (settingsName) settingsName.value = this.settings.username;
        if (profileName) profileName.textContent = this.settings.username;

        // Apply Theme
        document.body.classList.remove('theme-light', 'theme-dark');
        if (this.settings.theme === 'light') {
            document.body.classList.add('theme-light');
        } else {
            document.body.classList.add('theme-dark');
        }

        document.querySelectorAll('.theme-option').forEach(opt => {
            opt.classList.toggle('active', opt.id === `theme-${this.settings.theme}`);
        });

        // Apply Accent
        document.documentElement.style.setProperty('--primary', this.settings.accent);
        document.querySelectorAll('.color-swatch').forEach(sw => {
            const swatchColor = sw.style.backgroundColor;
            // Handle hex to rgb conversion comparison if needed, or just compare roughly
            sw.classList.toggle('active', this.settings.accent && swatchColor.includes(this.settings.accent.toLowerCase()));
        });
    }

    updateProfile() {
        const newName = document.getElementById('settings-username').value;
        if (!newName) return;
        this.settings.username = newName;
        localStorage.setItem('settings', JSON.stringify(this.settings));
        this.applySettings();
        this.showToast('Profile updated successfully!', 'success');
    }

    setAccent(color, el) {
        this.settings.accent = color;
        localStorage.setItem('settings', JSON.stringify(this.settings));
        this.applySettings();

        // Update swatch active state
        document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.remove('active'));
        el.classList.add('active');
    }

    exportBackup() {
        const backupData = {
            transactions: this.transactions,
            categories: this.categories,
            budget: this.budget,
            settings: this.settings
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `SpendWise_Backup_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
    }

    importBackup(input) {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.transactions) localStorage.setItem('transactions', JSON.stringify(data.transactions));
                if (data.categories) localStorage.setItem('categories', JSON.stringify(data.categories));
                if (data.budget) localStorage.setItem('monthlyBudget', JSON.stringify(data.budget));
                if (data.settings) localStorage.setItem('settings', JSON.stringify(data.settings));

                this.showToast('Backup restored successfully!', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } catch (err) {
                this.showToast('Invalid backup file!', 'error');
            }
        };
        reader.readAsText(file);
    }

    resetEverything() {
        this.confirmDialog('NUCLEAR OPTION: This will delete ALL your data and settings. Are you absolutely sure?', 'alert-triangle').then(ok => {
            if (ok) {
                localStorage.clear();
                this.showToast('App has been reset.', 'info');
                setTimeout(() => window.location.reload(), 1000);
            }
        });
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : 'info';

        toast.innerHTML = `
            <i data-lucide="${icon}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);
        if (window.lucide) lucide.createIcons();

        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => window.app = new SpendWise());
