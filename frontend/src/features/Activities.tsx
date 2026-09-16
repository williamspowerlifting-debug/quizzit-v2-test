import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";

export function Activities({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { teacher } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  async function load() {
    if (!teacher) return;

    setLoading(true);

    try {
      setItems(
        (await api.listActivities(teacher.id)).exercises || []
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [teacher?.id]);

  async function duplicateActivity(exerciseId: string) {
    if (!teacher || duplicating) return;

    setDuplicating(exerciseId);

    try {
      // Load the complete original activity
      const original = await api.loadActivity(
        teacher.id,
        exerciseId
      );

      // Create an independent copy.
      // Do NOT copy exerciseId or lessonId.
      const duplicate = {
        ...original,
        exerciseId: undefined,
        lessonId: null,
        name: `${original.name || "Listening Activity"} - Copy`,
        createdAt: undefined,
        updatedAt: undefined,
      };

      // Save as a new activity.
      // The Worker will generate a new exerciseId.
      const saved = await api.saveActivity(duplicate);

      // Refresh the activity list so the new copy appears.
      await load();

      // Open the newly created activity in the Builder.
      onOpen(saved.exerciseId);
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : "Unable to duplicate this activity."
      );
    } finally {
      setDuplicating(null);
    }
  }

  const filtered = items.filter((x) =>
    (x.name || x.title || "")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h1>My Activities</h1>
          <p className="muted">
            Your saved listening activities.
          </p>
        </div>

        <button className="primary" onClick={onNew}>
          Create Activity
        </button>
      </div>

      <input
        placeholder="Search activities…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No activities yet.</p>
      ) : (
        <div className="activity-list">
          {filtered.map((x) => (
            <article
              className="activity-item"
              key={x.exerciseId}
            >
              <div>
                <h3>{x.name || x.title}</h3>

                <p>
                  {x.updatedAt
                    ? new Date(x.updatedAt).toLocaleString()
                    : ""}
                </p>

                <div>
                  {(x.tags || []).map((t: string) => (
                    <span className="tag small" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="actions">
                <button
                  onClick={() => onOpen(x.exerciseId)}
                >
                  Open
                </button>

                <button
                  onClick={() =>
                    duplicateActivity(x.exerciseId)
                  }
                  disabled={duplicating === x.exerciseId}
                >
                  {duplicating === x.exerciseId
                    ? "Duplicating…"
                    : "Duplicate"}
                </button>

                <button
                  className="danger"
                  onClick={async () => {
                    if (confirm("Delete this activity?")) {
                      await api.deleteActivity(x.exerciseId);
                      load();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
