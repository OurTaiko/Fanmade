-- Migration 054: every block is under hash algorithm v2, and 053's exception ends.
-- The triggers are 046's and 051's again: a block's scores stop being the latest, and its 段位
-- songs valid, whenever its hash changes (the next algorithm included, unless a migration
-- says otherwise as 053 did), and any update of a block is a change of the chart.
DROP TRIGGER chart_difficulties_retire_scores ON chart_difficulties;
CREATE TRIGGER chart_difficulties_retire_scores AFTER UPDATE OF content_hash ON chart_difficulties
 FOR EACH ROW WHEN (OLD.content_hash IS NOT NULL AND OLD.content_hash IS DISTINCT FROM NEW.content_hash)
 EXECUTE FUNCTION chart_difficulties_retire_scores();

DROP TRIGGER chart_difficulties_touch_chart_update ON chart_difficulties;
DROP TRIGGER chart_difficulties_touch_chart ON chart_difficulties;
CREATE TRIGGER chart_difficulties_touch_chart AFTER INSERT OR UPDATE OR DELETE ON chart_difficulties
  FOR EACH ROW EXECUTE FUNCTION touch_related_chart();
