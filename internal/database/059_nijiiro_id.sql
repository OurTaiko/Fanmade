-- A chart may carry the Nijiiro ID of the official song it charts, as on OurTaiko Database
-- (its R062); each names one chart, so /charts/{n}?by=nijiiro has one answer. The field is
-- disabled on this site: the API reads it and no request writes it, so it stays null.
ALTER TABLE charts ADD COLUMN nijiiro_id integer CHECK (nijiiro_id > 0);
CREATE UNIQUE INDEX charts_nijiiro_id ON charts(nijiiro_id) WHERE nijiiro_id IS NOT NULL;
