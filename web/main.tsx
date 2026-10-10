import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Zap,
  Radio,
  Bell,
  History,
  Settings,
  Plus,
  ArrowUpRight,
  MapPin,
  Check,
  X,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  ChevronRight,
  LogOut,
  Smartphone,
  Activity,
  Clock,
  Download,
  SlidersHorizontal,
  BarChart3,
  CalendarDays,
  AlertCircle,
  Trash2,
  Pencil,
} from "lucide-react";
import { api, json } from "./api";
import { useHashRoute, historyPaths, type HistoryView } from "./routing";
import {
  useLocalFilters,
  decodeStockFilters,
  decodeHistoryFilters,
  normalizeStockFilters,
  normalizeHistoryFilters,
  historyDates,
  type StockFilters,
  type HistoryFilters,
} from "./preferences";
import type {
  Product,
  Store,
  Watch,
  StockState,
  MonitorStatus,
  QueryCount,
} from "../src/core/types";
import type { aggregateAvailability } from "../src/core/availability";
import { hkDate, hkTime } from "../src/core/domain";
import "./style.css";
type Catalog = { products: Product[]; stores: Store[] };
type Status = MonitorStatus & {
  notifications: {
    id: string;
    createdAt: number;
    attempts: number;
    status: string;
  }[];
  diagnostics: { id: string; at: number; message: string }[];
};
type Stats = ReturnType<typeof aggregateAvailability> & {
  queryCountsStartedAt: number | null;
};
const colors: Record<string, string> = {
  burgundy: "酒红色",
  glacier: "冰川蓝色",
  silver: "银色",
  black: "黑色",
};
const swatch: Record<string, string> = {
  burgundy: "#783442",
  glacier: "#b3d1dc",
  silver: "#d7d9db",
  black: "#34383c",
};
const percent = (rate: number | null | undefined) =>
  rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
const slotLabel = (time: string, minutes: number) => {
  const [h, m] = time.split(":").map(Number),
    end = h * 60 + m + minutes;
  return `${time}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
};
const stamp = (at: number | null) =>
  at ? `${hkDate(at)} ${hkTime(at)}` : "尚未查询";
const navigation = [
  { id: "stock", label: "实时库存", icon: Radio },
  { id: "watches", label: "我的关注", icon: Bell },
  { id: "history", label: "历史分析", icon: History },
  { id: "settings", label: "设置", icon: Settings },
] as const;
function Empty({
  icon: Icon = Radio,
  title,
  body,
  action,
}: {
  icon?: typeof Radio;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={27} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function App() {
  const route = useHashRoute(),
    tab = route.tab;
  const [session, setSession] = useState<boolean | null>(null),
    [password, setPassword] = useState("");
  const [catalog, setCatalog] = useState<Catalog>({ products: [], stores: [] }),
    [stock, setStock] = useState<(StockState & { stale: boolean })[]>([]),
    [status, setStatus] = useState<Status | null>(null),
    [watches, setWatches] = useState<Watch[]>([]);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState<Watch | "new" | null>(null);
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 3500);
  };
  const refresh = async () => {
    try {
      const [c, s, m, w] = await Promise.all([
        api<Catalog>("/catalog"),
        api<typeof stock>("/stock"),
        api<Status>("/status"),
        api<Watch[]>("/watches"),
      ]);
      setCatalog(c);
      setStock(s);
      setStatus(m);
      setWatches(w);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    api("/session")
      .then(() => setSession(true))
      .catch(() => setSession(false));
    const expired = () => setSession(false);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!session) return;
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [session]);
  const execute = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      notify(message);
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (session === null)
    return (
      <div className="loading-page">
        <Zap />
        <p>正在连接 iPhone Ding…</p>
      </div>
    );
  if (!session)
    return (
      <main className="login-page">
        <div className="login-card">
          <div className="brand">
            <span className="brand-icon">
              <Zap fill="currentColor" size={22} />
            </span>
            iPhone Ding
          </div>
          <span className="eyebrow">HONG KONG · STOCK MONITOR</span>
          <h1>
            每一次到货，
            <br />
            及时知道。
          </h1>
          <p>关注香港门店库存，找到更常有货的时段。</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/login", json("POST", { password }));
                setPassword("");
                setSession(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              管理员密码
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="输入部署时设置的密码"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "正在登录…" : "进入监控台"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <div className="login-footer">
            <ShieldCheck size={15} />
            个人监控台 · 仅授权访问
          </div>
        </div>
        <div className="login-decoration">
          <Smartphone size={110} strokeWidth={1} />
          <span className="decoration-dot" />
          <p>CHECK. DING. PICK UP.</p>
        </div>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/stock">
          <span className="brand-icon">
            <Zap size={22} fill="currentColor" />
          </span>
          iPhone Ding
        </a>
        <div className="sidebar-caption">你的香港购机助手</div>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              className={tab === id ? "nav-item active" : "nav-item"}
              href={`#/${id}`}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={20} />
              {label}
              {id === "watches" && (
                <span className="nav-count">{watches.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="region-label">
            <MapPin size={17} />
            <span>
              香港 <small>HONG KONG</small>
            </span>
            <span className="region-dot" />
          </div>
          <p>
            所有时间均为香港时间
            <br />
            库存以 Apple 官网为准
          </p>
          <button
            className="text-button"
            onClick={() =>
              execute(async () => {
                await api("/logout", { method: "POST" });
                setSession(false);
              }, "已退出")
            }
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            监控台 <ChevronRight size={14} />
            <strong>{navigation.find((n) => n.id === tab)?.label}</strong>
          </span>
          <div
            className={`connection ${!status?.enabled || status?.error ? "warning" : ""}`}
          >
            <span />
            {status === null
              ? "正在连接"
              : status?.enabled
                ? status.error
                  ? "采集需要关注"
                  : status.lastSuccessAt
                    ? "后台监控中"
                    : "等待首次采集"
                : "采集已暂停"}
          </div>
        </header>
        <main className="content">
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={18} />
              {error}
              <button onClick={refresh}>重试</button>
            </div>
          )}
          {tab === "stock" && (
            <StockPage
              catalog={catalog}
              stock={stock}
              status={status}
              refresh={refresh}
              onWatch={() => setEditor("new")}
            />
          )}
          {tab === "watches" && (
            <>
              <PageTitle
                eyebrow="YOUR WATCHLIST"
                title="关注你想要的那一款"
                description="多种规格同时关注，有货时推送到 iPhone。"
                action={
                  <button className="primary" onClick={() => setEditor("new")}>
                    <Plus size={17} />
                    添加关注
                  </button>
                }
              />
              <div className="notice">
                <Bell size={18} />
                暂停关注只关闭通知，历史库存仍会持续采集。
              </div>
              {!watches.length ? (
                <Empty
                  icon={Bell}
                  title="还没有关注的规格"
                  body="选择机型、颜色、容量与门店，让我们帮你留意。"
                  action={
                    <button
                      className="primary"
                      onClick={() => setEditor("new")}
                    >
                      <Plus size={17} />
                      添加第一条关注
                    </button>
                  }
                />
              ) : (
                <div className="watch-grid">
                  {watches.map((w) => (
                    <article className="panel watch-card" key={w.id}>
                      <div className="card-head">
                        <span
                          className={`badge ${w.enabled ? "blue" : "muted"}`}
                        >
                          {w.enabled ? "通知开启" : "通知暂停"}
                        </span>
                        <div className="icon-actions">
                          <button
                            aria-label={`编辑 ${w.name}`}
                            onClick={() => setEditor(w)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            aria-label={`删除 ${w.name}`}
                            onClick={() =>
                              execute(
                                () =>
                                  api(`/watches/${w.id}`, { method: "DELETE" }),
                                "关注已删除",
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <h3>{w.name}</h3>
                      <div className="watch-specs">
                        {w.productIds.map((id) => {
                          const p = catalog.products.find((p) => p.id === id);
                          return (
                            <span key={id}>
                              {p
                                ? `${p.model.replace("iPhone ", "")} · ${colors[p.color] ?? p.color} · ${p.capacity}`
                                : id}
                            </span>
                          );
                        })}
                      </div>
                      <p className="store-summary">
                        <MapPin size={15} />
                        {w.storeIds.length === catalog.stores.length
                          ? "香港全部门店"
                          : w.storeIds
                              .map(
                                (id) =>
                                  catalog.stores.find((s) => s.id === id)
                                    ?.name ?? id,
                              )
                              .join("、")}
                      </p>
                      <button
                        disabled={busy}
                        className="secondary wide"
                        onClick={() =>
                          execute(
                            () =>
                              api(
                                `/watches/${w.id}`,
                                json("PUT", { ...w, enabled: !w.enabled }),
                              ),
                            w.enabled ? "通知已暂停" : "通知已开启",
                          )
                        }
                      >
                        {w.enabled ? <Pause size={15} /> : <Play size={15} />}{" "}
                        {w.enabled ? "暂停通知" : "恢复通知"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "history" && (
            <HistoryPage
              catalog={catalog}
              notify={notify}
              view={route.historyView}
            />
          )}
          {tab === "settings" && (
            <SettingsPage status={status} busy={busy} execute={execute} />
          )}
          <footer className="page-footer">
            <span>iPhone Ding</span>
            <span>香港门店取货库存 · 不代表库存台数</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav">
        {navigation.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            className={tab === id ? "active" : ""}
            href={`#/${id}`}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon size={21} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      {editor && (
        <WatchEditor
          catalog={catalog}
          watch={editor === "new" ? undefined : editor}
          close={() => setEditor(null)}
          save={async (w) => {
            await api(
              editor === "new" ? "/watches" : `/watches/${editor.id}`,
              json(editor === "new" ? "POST" : "PUT", w),
            );
            setEditor(null);
            notify("关注已保存");
            await refresh();
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function StockPage({
  catalog,
  stock,
  status,
  refresh,
  onWatch,
}: {
  catalog: Catalog;
  stock: (StockState & { stale: boolean })[];
  status: Status | null;
  refresh: () => Promise<void>;
  onWatch: () => void;
}) {
  const [savedFilters, setFilters] = useLocalFilters(
    "stock",
    decodeStockFilters,
  );
  const filters = normalizeStockFilters(savedFilters, catalog.products);
  const { model, color, capacity } = filters;
  useEffect(() => {
    if (filters !== savedFilters) setFilters(filters);
  }, [filters, savedFilters, setFilters]);
  const select = (field: keyof StockFilters, value: string) =>
    setFilters((current) =>
      normalizeStockFilters({ ...current, [field]: value }, catalog.products),
    );
  const product = catalog.products.find(
    (p) =>
      p.model === model &&
      p.color === color &&
      p.capacity === capacity &&
      p.active,
  );
  const rows = stock.filter((s) => s.productId === product?.id),
    available = rows.filter((s) => s.status === "available" && !s.stale).length;
  const models = [
    ...new Set(catalog.products.filter((p) => p.active).map((p) => p.model)),
  ].sort();
  const relevant = catalog.products.filter(
    (p) => p.active && p.model === model,
  );
  return (
    <>
      <PageTitle
        eyebrow="LIVE AVAILABILITY"
        title="好消息，不用一直等在页面前"
        description="后台持续留意香港门店，有货时第一时间通知你。"
        action={
          <button className="secondary" onClick={refresh}>
            <RefreshCw size={16} />
            刷新页面
          </button>
        }
      />
      <section className="stock-hero panel">
        <div
          className="phone-art"
          style={{ "--phone-color": swatch[color] } as React.CSSProperties}
        >
          <div className="camera-island">
            <i />
            <i />
            <i />
            <b />
          </div>
          <span className="phone-mark">●</span>
        </div>
        <div className="stock-hero-copy">
          <div className="badge blue">
            <MapPin size={12} />
            香港 · {catalog.stores.length} 家门店
          </div>
          <h2>{model}</h2>
          <p>
            <span className="color-dot" style={{ background: swatch[color] }} />
            {colors[color]}
            <span className="separator">/</span>
            {capacity}
          </p>
          <a
            href={
              product?.url ??
              "https://www.apple.com/hk/shop/buy-iphone/iphone-18-pro"
            }
            target="_blank"
            rel="noreferrer"
          >
            前往 Apple 官网 <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="available-total">
          <span>当前可取货门店</span>
          <strong>
            {!rows.length ? "—" : available}
            <small> / {catalog.stores.length}</small>
          </strong>
          <span className="updated">
            {!rows.length
              ? "等待首次查询"
              : `更新于 ${hkTime(Math.max(...rows.map((s) => s.attemptedAt)))}`}
          </span>
        </div>
      </section>
      <div className="filter-panel panel">
        <SlidersHorizontal size={18} />
        <Select
          label="机型"
          value={model}
          onChange={(s) => select("model", s)}
          options={models.map((value) => ({ value, label: value }))}
        />
        <Select
          label="颜色"
          value={color}
          onChange={(s) => select("color", s)}
          options={[...new Set(relevant.map((p) => p.color))].map((value) => ({
            value,
            label: colors[value] ?? value,
          }))}
        />
        <Select
          label="容量"
          value={capacity}
          onChange={(s) => select("capacity", s)}
          options={[
            ...new Set(
              relevant.filter((p) => p.color === color).map((p) => p.capacity),
            ),
          ]
            .sort(
              (a, b) =>
                parseInt(a) * (a.includes("TB") ? 1024 : 1) -
                parseInt(b) * (b.includes("TB") ? 1024 : 1),
            )
            .map((value) => ({ value, label: value }))}
        />
      </div>
      {status?.error && (
        <div className="notice warning">
          <AlertCircle size={17} />
          {status.error}；失效数据不会视为无货。
        </div>
      )}
      <div className="section-heading">
        <h2>
          门店库存 <span>{catalog.stores.length}</span>
        </h2>
        <span className="subtle">
          <Clock size={14} />
          正常每 30 秒检查
        </span>
      </div>
      <div className="store-grid">
        {catalog.stores.map((s, i) => {
          const row = rows.find((r) => r.storeId === s.id);
          const good = row?.status === "available" && !row.stale,
            unknown = !row || row.status === "unknown" || row.stale;
          return (
            <article
              className={`store-card panel ${good ? "in-stock" : ""}`}
              key={s.id}
            >
              <div className="store-top">
                <span className="store-index">0{i + 1}</span>
                <MapPin size={18} />
              </div>
              <h3>{s.name}</h3>
              <div
                className={`stock-label ${good ? "good" : unknown ? "unknown" : ""}`}
              >
                <span />
                {good
                  ? "可预约取货"
                  : unknown
                    ? row?.stale
                      ? "数据已过期"
                      : row
                        ? "查询暂不可用"
                        : "等待查询"
                    : "暂时无货"}
              </div>
              <div className="store-bottom">
                <span>
                  {row?.checkedAt ? hkTime(row.checkedAt) : "尚未成功查询"}
                </span>
                {good && (
                  <a href={product?.url} target="_blank" rel="noreferrer">
                    去下单
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <div className="cta-panel">
        <div className="cta-icon">
          <Bell size={23} />
        </div>
        <div>
          <h3>把等待交给后台</h3>
          <p>关注多个规格，关闭页面后也能收到 Bark 通知。</p>
        </div>
        <button className="primary" onClick={onWatch}>
          <Plus size={16} />
          添加关注
        </button>
      </div>
    </>
  );
}
function WatchEditor({
  catalog,
  watch,
  close,
  save,
}: {
  catalog: Catalog;
  watch?: Watch;
  close: () => void;
  save: (w: Omit<Watch, "id">) => Promise<void>;
}) {
  const [name, setName] = useState(watch?.name ?? "我的购机目标"),
    [model, setModel] = useState(
      watch
        ? (catalog.products.find((p) => p.id === watch.productIds[0])?.model ??
            "iPhone 18 Pro")
        : "iPhone 18 Pro",
    );
  const [selectedColors, setColors] = useState<string[]>(
    watch
      ? ([
          ...new Set(
            watch.productIds
              .map((id) => catalog.products.find((p) => p.id === id)?.color)
              .filter(Boolean),
          ),
        ] as string[])
      : ["burgundy"],
  );
  const [capacities, setCapacities] = useState<string[]>(
    watch
      ? ([
          ...new Set(
            watch.productIds
              .map((id) => catalog.products.find((p) => p.id === id)?.capacity)
              .filter(Boolean),
          ),
        ] as string[])
      : ["256GB"],
  );
  const [stores, setStores] = useState(
      watch?.storeIds ?? catalog.stores.map((s) => s.id),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [extraProducts, setExtraProducts] = useState(
    watch?.productIds.filter(
      (id) => catalog.products.find((p) => p.id === id)?.model !== model,
    ) ?? [],
  );
  const toggle = (
    values: string[],
    value: string,
    set: (a: string[]) => void,
  ) =>
    set(
      values.includes(value)
        ? values.filter((x) => x !== value)
        : [...values, value],
    );
  const matches = catalog.products.filter(
    (p) =>
      p.active &&
      p.model === model &&
      selectedColors.includes(p.color) &&
      capacities.includes(p.capacity),
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", key);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="关注设置"
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">STAY IN THE KNOW</span>
            <h2>{watch ? "编辑关注" : "添加关注"}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="关闭">
            <X size={21} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await save({
                name,
                productIds: [
                  ...new Set([...matches.map((p) => p.id), ...extraProducts]),
                ],
                storeIds: stores,
                enabled: watch?.enabled ?? true,
              });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            关注名称
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </label>
          <fieldset>
            <legend>机型</legend>
            <div className="choice-grid">
              {["iPhone 18 Pro", "iPhone 18 Pro Max"].map((m) => (
                <button
                  type="button"
                  key={m}
                  className={model === m ? "choice selected" : "choice"}
                  onClick={() => {
                    setModel(m);
                    setExtraProducts([]);
                  }}
                >
                  {m.replace("iPhone ", "")}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              颜色 <small>可多选</small>
            </legend>
            <div className="choice-grid">
              {Object.entries(colors).map(([c, label]) => (
                <button
                  type="button"
                  key={c}
                  className={
                    selectedColors.includes(c) ? "choice selected" : "choice"
                  }
                  onClick={() => toggle(selectedColors, c, setColors)}
                >
                  <span
                    className="color-dot"
                    style={{ background: swatch[c] }}
                  />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              容量 <small>可多选</small>
            </legend>
            <div className="choice-grid">
              {["256GB", "512GB", "1TB", "2TB"].map((c) => (
                <button
                  type="button"
                  key={c}
                  className={
                    capacities.includes(c) ? "choice selected" : "choice"
                  }
                  onClick={() => toggle(capacities, c, setCapacities)}
                >
                  {c}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              香港门店{" "}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setStores(
                    stores.length === catalog.stores.length
                      ? []
                      : catalog.stores.map((s) => s.id),
                  )
                }
              >
                {stores.length === catalog.stores.length ? "取消全选" : "全选"}
              </button>
            </legend>
            <div className="choice-grid">
              {catalog.stores.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={
                    stores.includes(s.id) ? "choice selected" : "choice"
                  }
                  onClick={() => toggle(stores, s.id, setStores)}
                >
                  {s.name}
                  {stores.includes(s.id) && <Check size={14} />}
                </button>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <span>
              {matches.length + extraProducts.length} 个有效规格 ·{" "}
              {stores.length} 家门店
            </span>
            <button
              disabled={
                busy ||
                (!matches.length && !extraProducts.length) ||
                !stores.length
              }
              className="primary"
            >
              {busy ? "正在保存…" : "保存关注"}
              <Check size={16} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function HistoryPage({
  catalog,
  notify,
  view,
}: {
  catalog: Catalog;
  notify: (s: string) => void;
  view: HistoryView;
}) {
  const today = hkDate(Date.now());
  const [savedFilters, setFilters] = useLocalFilters(
    "history",
    decodeHistoryFilters,
  );
  const filters = normalizeHistoryFilters(
    savedFilters,
    catalog.products,
    catalog.stores,
  );
  const { model, color, capacity, storeId, days, minutes } = filters;
  const { from, to } = historyDates(filters);
  useEffect(() => {
    if (filters !== savedFilters) setFilters(filters);
  }, [filters, savedFilters, setFilters]);
  const select = <K extends keyof HistoryFilters>(
    field: K,
    value: HistoryFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };
  const [stats, setStats] = useState<Stats | null>(null),
    [events, setEvents] = useState<{
      items: QueryCount[];
      total: number;
      page: number;
      limit: number;
    } | null>(null),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const params = new URLSearchParams({
    from,
    to,
    minutes: String(minutes),
    ...(model ? { model } : {}),
    ...(color ? { color } : {}),
    ...(capacity ? { capacity } : {}),
    ...(storeId ? { storeId } : {}),
  }).toString();
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    Promise.all([
      api<Stats>(`/history/stats?${params}`),
      api<NonNullable<typeof events>>(
        `/history/queries?${params}&page=${page}&availableOnly=true`,
      ),
    ])
      .then(([s, e]) => {
        if (current) {
          setStats(s);
          setEvents(e);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [params, page, revision]);
  useEffect(() => {
    const timer = setInterval(() => setRevision((x) => x + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const changeRange = (days: 1 | 7 | 30) => {
    setFilters((current) => ({
      ...current,
      days,
      ...historyDates({ days, from, to }),
    }));
    setPage(1);
  };
  const top = stats?.ranking.find((r) => r.availableChecks > 0);
  const chartSlots = [...(stats?.ranking ?? [])].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const dates = [...new Set(stats?.buckets.map((b) => b.date) ?? [])];
  const describe = (s: {
    availableChecks: number;
    validChecks: number;
    unknownChecks: number;
    hitRate: number | null;
    coverageRatio: number;
  }) =>
    `有货 ${s.availableChecks} / 有效查询 ${s.validChecks} 次 · 有货率 ${percent(s.hitRate)} · 失败/未知 ${s.unknownChecks} 次 · 覆盖率 ${(s.coverageRatio * 100).toFixed(1)}%`;
  return (
    <>
      <PageTitle
        eyebrow="FIND YOUR WINDOW"
        title="哪个时段，更常有货"
        description="每次查到有货都计数，用有货率比较下单时段。"
        action={
          <a
            className="secondary"
            href={`/api/history/export?kind=queries&${params}`}
          >
            <Download size={16} />
            导出查询统计
          </a>
        }
      />
      <section className="history-filters panel">
        <div className="range-row">
          <div className="range-buttons">
            {[
              [1, "今天"],
              [7, "近 7 天"],
              [30, "近 30 天"],
            ].map(([n, label]) => (
              <button
                key={n}
                className={days === n ? "active" : ""}
                onClick={() => changeRange(Number(n) as 1 | 7 | 30)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="date-fields">
            <label>
              <span className="sr-only">开始日期</span>
              <input
                aria-label="开始日期"
                type="date"
                value={from}
                max={to}
                onChange={(e) => {
                  const from = e.target.value;
                  setFilters((current) => ({ ...current, days: 0, from, to }));
                  setPage(1);
                }}
              />
            </label>
            <span>至</span>
            <label>
              <span className="sr-only">结束日期</span>
              <input
                aria-label="结束日期"
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => {
                  const to = e.target.value;
                  setFilters((current) => ({ ...current, days: 0, from, to }));
                  setPage(1);
                }}
              />
            </label>
            <button
              className="icon-button"
              title="刷新历史"
              aria-label="刷新历史"
              onClick={() => setRevision((x) => x + 1)}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <div className="history-selects">
          <Select
            label="机型"
            value={model}
            onChange={(s) => select("model", s)}
            options={[
              { value: "", label: "全部机型" },
              ...[...new Set(catalog.products.map((p) => p.model))]
                .sort()
                .map((value) => ({
                  value,
                  label: value,
                })),
            ]}
          />
          <Select
            label="颜色"
            value={color}
            onChange={(s) => select("color", s)}
            options={[
              { value: "", label: "全部颜色" },
              ...[...new Set(catalog.products.map((p) => p.color))].map(
                (value) => ({
                  value,
                  label: colors[value] ?? value,
                }),
              ),
            ]}
          />
          <Select
            label="容量"
            value={capacity}
            onChange={(s) => select("capacity", s)}
            options={[
              { value: "", label: "全部容量" },
              ...[...new Set(catalog.products.map((p) => p.capacity))]
                .sort(
                  (a, b) =>
                    parseInt(a) * (a.includes("TB") ? 1024 : 1) -
                    parseInt(b) * (b.includes("TB") ? 1024 : 1),
                )
                .map((value) => ({
                  value,
                  label: value,
                })),
            ]}
          />
          <Select
            label="门店"
            value={storeId}
            onChange={(s) => select("storeId", s)}
            options={[
              { value: "", label: "香港全部门店" },
              ...catalog.stores.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
      </section>
      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={17} />
          {error}
        </div>
      )}
      <p className="history-count-note">
        {stats?.queryCountsStartedAt
          ? `查询计数从 ${stamp(stats.queryCountsStartedAt)} 开始积累。`
          : "更新后的采集程序开始运行后，将积累查询计数。"}
        每个规格 × 门店计一次；多选时汇总所有组合。旧状态记录无法还原查询次数。
      </p>
      <div className={`metrics-grid ${loading ? "is-loading" : ""}`}>
        <Metric
          label="有货查询次数"
          value={stats ? String(stats.totals.availableChecks) : "—"}
          unit="次"
          icon={Activity}
          note="连续有货、首次和恢复查询均计数"
        />
        <Metric
          label="有效查询有货率"
          value={
            stats?.totals.hitRate == null
              ? "—"
              : (stats.totals.hitRate * 100).toFixed(1)
          }
          unit={stats?.totals.hitRate == null ? undefined : "%"}
          icon={ShieldCheck}
          note={
            stats
              ? `有货 ${stats.totals.availableChecks} / 有效 ${stats.totals.validChecks} 次 · 失败/未知 ${stats.totals.unknownChecks} 次`
              : "等待有效查询"
          }
        />
        <Metric
          label="较高有货率时段"
          value={top ? slotLabel(top.time, minutes) : "—"}
          icon={Clock}
          note={
            top
              ? `${percent(top.hitRate)} · ${top.availableChecks} / ${top.validChecks} 次${top.coverageRatio < 0.5 ? " · 覆盖较少" : ""}`
              : "有货样本积累后显示"
          }
        />
      </div>
      <div className="history-tabs" role="tablist" aria-label="历史视图">
        {[
          { id: "events", label: "有货记录", icon: History },
          { id: "analysis", label: "时段分析", icon: BarChart3 },
          { id: "stores", label: "门店对比", icon: MapPin },
        ].map(({ id, label, icon: Icon }) => (
          <a
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            key={id}
            href={historyPaths[id as HistoryView]}
          >
            <Icon size={17} />
            {label}
          </a>
        ))}
      </div>
      {loading && (
        <div className="inline-loading" role="status">
          正在汇总历史数据…
        </div>
      )}
      {!loading && !error && view === "analysis" && (
        <>
          <section className="panel chart-panel">
            <div className="chart-header">
              <div>
                <h2>一天中的有货率</h2>
                <p>有货次数 ÷ 有效查询次数 · 固定 0–100% 刻度 · 香港时间</p>
              </div>
              <div className="segmented">
                {[15, 60].map((n) => (
                  <button
                    key={n}
                    className={minutes === n ? "active" : ""}
                    onClick={() => select("minutes", n as 15 | 60)}
                  >
                    {n === 15 ? "15 分钟" : "1 小时"}
                  </button>
                ))}
              </div>
            </div>
            {stats?.totals.validChecks ? (
              <>
                <div
                  className="bar-chart"
                  aria-label="按时间段汇总的有货率柱状图"
                >
                  {chartSlots.map((s) => (
                    <button
                      className="bar-column"
                      key={s.time}
                      title={`${slotLabel(s.time, minutes)} · ${describe(s)}`}
                      aria-label={`${slotLabel(s.time, minutes)} · ${describe(s)}`}
                      onClick={() =>
                        notify(`${slotLabel(s.time, minutes)} · ${describe(s)}`)
                      }
                    >
                      <div
                        className={
                          s.coverageRatio < 0.5 ? "bar low-coverage" : "bar"
                        }
                        style={{
                          height: s.validChecks
                            ? `${(s.hitRate ?? 0) * 100}%`
                            : "0",
                        }}
                      />
                      <span>
                        {s.time.endsWith(":00") &&
                        Number(s.time.slice(0, 2)) % 6 === 0
                          ? s.time
                          : ""}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="chart-axis">
                  <span>00:00</span>
                  <span>06:00</span>
                  <span>12:00</span>
                  <span>18:00</span>
                  <span>24:00</span>
                </div>
                {!stats.totals.availableChecks && (
                  <p className="chart-caption">
                    当前范围内有有效查询，有货次数为 0。
                  </p>
                )}
              </>
            ) : (
              <Empty
                icon={BarChart3}
                title="等待有效查询样本"
                body="有货和无货结果均计入有效查询；失败或未知结果单独记录，不能当作无货。"
              />
            )}
          </section>
          <section className="panel heatmap-panel">
            <div className="chart-header">
              <div>
                <h2>每日有货率热力图</h2>
                <p>颜色越深，有效查询中有货的比例越高；点击查看次数</p>
              </div>
              <CalendarDays size={20} />
            </div>
            <div className="heatmap-scroll">
              <div
                className="heatmap"
                style={
                  { "--slot-count": 1440 / minutes } as React.CSSProperties
                }
              >
                <div className="heatmap-axis">
                  <span />
                  {Array.from({ length: 1440 / minutes }, (_, i) => (
                    <span key={i}>
                      {i % (360 / minutes) === 0
                        ? `${(i * minutes) / 60}:00`
                        : ""}
                    </span>
                  ))}
                </div>
                {dates.map((date) => (
                  <div className="heatmap-row" key={date}>
                    <span className="heatmap-date">{date.slice(5)}</span>
                    {Array.from({ length: 1440 / minutes }, (_, i) => {
                      const time = `${String(Math.floor((i * minutes) / 60)).padStart(2, "0")}:${String((i * minutes) % 60).padStart(2, "0")}`;
                      const b = stats?.buckets.find(
                          (b) => b.date === date && b.time === time,
                        ),
                        covered = b && b.validChecks > 0;
                      return (
                        <button
                          key={i}
                          className={`heat-cell ${!covered ? "no-coverage" : b.coverageRatio < 0.5 ? "partial" : ""}`}
                          style={
                            covered
                              ? {
                                  background: `rgba(7,104,249,${0.1 + 0.85 * (b.hitRate ?? 0)})`,
                                }
                              : undefined
                          }
                          aria-label={`${date} ${slotLabel(time, minutes)} ${covered ? describe(b) : `无有效查询${b?.unknownChecks ? ` · 失败/未知 ${b.unknownChecks} 次` : ""}`}`}
                          title={`${date} ${slotLabel(time, minutes)}\n${covered ? describe(b) : `无有效查询${b?.unknownChecks ? ` · 失败/未知 ${b.unknownChecks} 次` : ""}`}`}
                          onClick={() =>
                            notify(
                              covered
                                ? `${date} ${slotLabel(time, minutes)}：${describe(b)}`
                                : `${date} ${slotLabel(time, minutes)}：无有效查询${b?.unknownChecks ? ` · 失败/未知 ${b.unknownChecks} 次` : ""}`,
                            )
                          }
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="heatmap-legend">
              <span>
                <i className="no-coverage" />
                无有效查询
              </span>
              <span>
                <i className="partial" />
                覆盖不足 50%
              </span>
              <span>
                0% <i style={{ background: "#e7efff" }} />
                <i style={{ background: "#7aaafb" }} />
                <i style={{ background: "#0768f9" }} />
                100%
              </span>
            </div>
          </section>
          <section className="panel ranking-panel">
            <div className="chart-header">
              <div>
                <h2>有货率时段排行</h2>
                <p>跨日合并计数后比较有货率；同时查看样本量和覆盖情况</p>
              </div>
            </div>
            {stats?.ranking.filter((s) => s.validChecks > 0).length ? (
              <div className="ranking-list">
                {stats.ranking
                  .filter((s) => s.validChecks > 0)
                  .slice(0, 5)
                  .map((s, i) => (
                    <div className="ranking-row" key={s.time}>
                      <span className="rank">0{i + 1}</span>
                      <strong>{slotLabel(s.time, minutes)}</strong>
                      <div className="rank-bar">
                        <span style={{ width: `${(s.hitRate ?? 0) * 100}%` }} />
                      </div>
                      <span>{percent(s.hitRate)}</span>
                      <small>
                        有货 {s.availableChecks} / 有效 {s.validChecks} 次 ·
                        失败/未知 {s.unknownChecks} 次
                        {s.coverageRatio < 0.5 ? " · 覆盖较少" : ""}
                      </small>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="simple-empty">
                还没有有效查询样本，采集后会按有货率排列时段。
              </p>
            )}
          </section>
        </>
      )}
      {!loading && !error && view === "events" && (
        <section className="panel records-panel">
          <div className="chart-header">
            <div>
              <h2>每一次有货，都有记录</h2>
              <p>
                共 {events?.total ?? 0} 条有货时段记录 · 每个规格、门店按 15
                分钟汇总
              </p>
            </div>
          </div>
          {events?.items.length ? (
            events.items.map((e) => {
              const p = catalog.products.find((p) => p.id === e.productId),
                s = catalog.stores.find((s) => s.id === e.storeId);
              return (
                <article key={e.id} className="event-row">
                  <div className="event-icon restock">
                    <Activity size={17} />
                  </div>
                  <div className="event-main">
                    <div>
                      <strong>{s?.name ?? e.storeId}</strong>
                      <span className="badge blue">
                        有货 {e.available} / 有效 {e.available + e.unavailable}{" "}
                        次
                      </span>
                    </div>
                    <p>
                      {p?.model ?? e.productId} · {p ? colors[p.color] : ""} ·{" "}
                      {p?.capacity}
                    </p>
                    <p>
                      有货率{" "}
                      {percent(e.available / (e.available + e.unavailable))} ·
                      失败/未知 {e.unknown} 次
                    </p>
                  </div>
                  <time>
                    <strong>{slotLabel(hkTime(e.at).slice(0, 5), 15)}</strong>
                    <span>{hkDate(e.at)}</span>
                  </time>
                </article>
              );
            })
          ) : (
            <Empty
              icon={History}
              title="还没有有货记录"
              body="每次查询返回有货都会加计数，持续有货也会累计。"
            />
          )}
          {!!events?.total && (
            <div className="pagination">
              <button
                className="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>
                第 {page} / {Math.ceil(events.total / events.limit)} 页
              </span>
              <button
                className="secondary"
                disabled={page * events.limit >= events.total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      )}
      {!loading && !error && view === "stores" && (
        <section className="panel records-panel">
          <div className="chart-header">
            <div>
              <h2>哪家门店更常有货</h2>
              <p>按有货率排序；多个规格查询合并计数，有货时长按组合累计</p>
            </div>
          </div>
          {stats?.stores.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>门店</th>
                    <th>有货 / 有效查询</th>
                    <th>有货率</th>
                    <th>失败/未知</th>
                    <th>累计有货</th>
                    <th>有货天数</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.stores.map((s) => (
                    <tr key={s.storeId}>
                      <td>
                        {catalog.stores.find((x) => x.id === s.storeId)?.name ??
                          s.storeId}
                      </td>
                      <td>
                        <strong>
                          {s.availableChecks} / {s.validChecks}
                        </strong>{" "}
                        次
                      </td>
                      <td>{percent(s.hitRate)}</td>
                      <td>{s.unknownChecks} 次</td>
                      <td>{(s.availableSeconds / 3600).toFixed(1)} 小时</td>
                      <td>{s.availableDays} 天</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={MapPin}
              title="门店对比尚无数据"
              body="获得有效查询结果后，便能比较门店的有货率和次数。"
            />
          )}
        </section>
      )}
      <details className="stats-explainer">
        <summary>
          <AlertCircle size={15} />
          如何理解这些数据？
        </summary>
        <p>
          每个规格 × 门店的查询结果计一次；有货计数加一，持续有货每轮都累计。
          首次查询和中断后恢复查询得到有货也计数。有效查询 = 有货 +
          无货；失败、字段缺失和未知结果单列，不进入有货率分母。
        </p>
        <p>
          有货率 = 有货次数 ÷ 有效查询次数。例如 06:00–07:00 有效查询 120
          次，其中 100 次有货，有货率为 83.3%。
          多选规格或门店时合并全部组合；一次批量请求返回六家门店，就是六次组合观测。跨日按总有货次数
          ÷ 总有效查询次数计算。
        </p>
        <p>
          无有效样本的时段留白；有一个有效样本就能显示有货率。覆盖与有货时长仍按相邻成功查询间隔不超过
          90 秒的区间估算，覆盖不足 50% 标记纹理，但不隐藏排行。
          样本较少或经常请求失败的时段代表性有限。计数从更新后的采集程序运行时开始，旧状态事件不回填成查询计数。查询计数保留
          365 天，反映观测结果，不能推算库存台数或保证未来有货。
        </p>
      </details>
    </>
  );
}
function Metric({
  label,
  value,
  unit,
  icon: Icon,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: typeof Radio;
  note: string;
}) {
  return (
    <div className="panel metric">
      <div className="metric-label">
        {label}
        <Icon size={18} />
      </div>
      <div className={`metric-value ${value.length > 9 ? "compact" : ""}`}>
        {value}
        <small>{unit}</small>
      </div>
      <p>{note}</p>
    </div>
  );
}
function SettingsPage({
  status,
  busy,
  execute,
}: {
  status: Status | null;
  busy: boolean;
  execute: (fn: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [settings, setSettings] = useState<{
      barkConfigured: boolean;
      barkMasked: string | null;
      allowedHosts: string[];
    } | null>(null),
    [url, setUrl] = useState("");
  const load = () =>
    api<NonNullable<typeof settings>>("/settings").then(setSettings);
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="MAKE IT YOURS"
        title="让通知，真正到达"
        description="配置 Bark，确认手机能收到提醒，再交给后台。"
      />
      {status?.maintenance && (
        <div className="notice warning">
          <AlertCircle size={17} />
          备份／迁移模式：采集与推送均已暂停。核对完成后，恢复采集即可退出。
        </div>
      )}
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-title">
            <span className="setting-icon">
              <Bell size={21} />
            </span>
            <div>
              <h2>Bark 到货推送</h2>
              <p>只通知你关注的规格和门店</p>
            </div>
            <span
              className={`badge ${settings?.barkConfigured ? "blue" : "muted"}`}
            >
              {settings?.barkConfigured ? "已配置" : "未配置"}
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                await api("/settings", json("PUT", { barkUrl: url }));
                setUrl("");
                await load();
              }, "Bark 地址已保存");
            }}
          >
            <label>
              设备推送地址
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  settings?.barkMasked ?? "https://api.day.app/你的设备密钥"
                }
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </label>
            <p className="field-help">
              从 Bark App 复制设备地址。密钥只保存在后台，不在页面回显。
            </p>
            <div className="settings-buttons">
              <button className="primary" disabled={busy || !url}>
                保存配置
                <Check size={15} />
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !settings?.barkConfigured}
                onClick={() =>
                  execute(
                    () => api("/settings/test", json("POST", {})),
                    "测试通知已发送，请查看 iPhone",
                  )
                }
              >
                <Bell size={15} />
                测试通知
              </button>
            </div>
          </form>
          {settings?.barkConfigured && (
            <button
              className="text-button danger"
              disabled={busy}
              onClick={() =>
                execute(async () => {
                  await api("/settings", json("PUT", { barkUrl: "" }));
                  await load();
                }, "Bark 配置已清除")
              }
            >
              清除推送地址
            </button>
          )}
          <div className="notice compact">
            <ShieldCheck size={16} />
            允许的推送服务：{settings?.allowedHosts.join("、") ?? "加载中"}
          </div>
        </section>
        <section className="panel settings-card">
          <div className="settings-title">
            <span className="setting-icon green">
              <Activity size={21} />
            </span>
            <div>
              <h2>后台采集</h2>
              <p>全部有效规格 · 香港全部门店</p>
            </div>
          </div>
          <dl className="status-list">
            <div>
              <dt>目标查询间隔</dt>
              <dd>30 秒</dd>
            </div>
            <div>
              <dt>上次查询</dt>
              <dd>{stamp(status?.lastAttemptAt ?? null)}</dd>
            </div>
            <div>
              <dt>最近部分或全部成功</dt>
              <dd>{stamp(status?.lastSuccessAt ?? null)}</dd>
            </div>
            <div>
              <dt>目录验证时间</dt>
              <dd>{stamp(status?.catalogAt ?? null)}</dd>
            </div>
            <div>
              <dt>下次查询目标</dt>
              <dd>
                {status?.enabled && status.nextAt ? stamp(status.nextAt) : "—"}
              </dd>
            </div>
            <div>
              <dt>运行状态</dt>
              <dd>
                {status?.enabled
                  ? status.error
                    ? "退避 / 查询异常"
                    : "采集中"
                  : "已暂停"}
              </dd>
            </div>
          </dl>
          {status?.error && <p className="form-error">{status.error}</p>}
          <button
            className="secondary wide"
            disabled={busy || !status}
            onClick={() =>
              execute(
                () =>
                  api("/monitor", json("PUT", { enabled: !status?.enabled })),
                status?.enabled ? "后台采集已暂停" : "后台采集已恢复",
              )
            }
          >
            {status?.enabled ? <Pause size={16} /> : <Play size={16} />}{" "}
            {status?.enabled ? "暂停全部采集" : "恢复全部采集"}
          </button>
          <p className="field-help">
            暂停全部采集会造成历史覆盖缺口。仅关闭提醒，请到「我的关注」暂停通知。
          </p>
        </section>
      </div>
      <section className="panel records-panel">
        <div className="chart-header">
          <div>
            <h2>最近推送结果</h2>
            <p>发送确认不代表手机一定弹出了通知；请先使用测试通知。</p>
          </div>
        </div>
        {status?.notifications.length ? (
          <div className="notification-list">
            {status.notifications.map((n) => (
              <div key={n.id}>
                <span>{stamp(n.createdAt)}</span>
                <span>{n.attempts} 次尝试</span>
                <span
                  className={`badge ${n.status === "sent" ? "blue" : "muted"}`}
                >
                  {
                    (
                      {
                        pending: "待发送",
                        sending: "发送中",
                        sent: "已发送",
                        failed: "发送失败",
                        expired: "已过期",
                      } as Record<string, string>
                    )[n.status]
                  }
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="simple-empty">还没有库存推送记录</p>
        )}
      </section>
      {Boolean(status?.diagnostics.length) && (
        <section className="panel records-panel">
          <div className="chart-header">
            <h2>最近采集异常</h2>
          </div>
          {status?.diagnostics.map((d) => (
            <div className="diagnostic-row" key={d.id}>
              <time>{stamp(d.at)}</time>
              <span>{d.message}</span>
            </div>
          ))}
        </section>
      )}
      <div className="notice">
        <Clock size={17} />
        限流或网络异常时会自动放慢查询。历史保留 365 天，请定期备份数据库。
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
