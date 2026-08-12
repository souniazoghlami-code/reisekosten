import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from('kv_store')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) {
      console.error('storage.get error', error);
      return null;
    }

    return data ? { key, value: data.value } : null;
  },

  async set(key, value) {
    const { error } = await supabase
      .from('kv_store')
      .upsert({ key, value }, { onConflict: 'key' });

    if (error) {
      console.error('storage.set error', error);
      return null;
    }

    return { key, value };
  },

  async delete(key) {
    const { error } = await supabase
      .from('kv_store')
      .delete()
      .eq('key', key);

    if (error) {
      console.error('storage.delete error', error);
      return null;
    }

    return { key, deleted: true };
  },
};
export const receiptStorage = {
  async upload(expenseId, dataUrl) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const filePath = `${expenseId}.jpg`;

      const { error } = await supabase.storage
        .from('receipts')
        .upload(filePath, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (error) {
        console.error('Beleg-Upload fehlgeschlagen', error);
        return null;
      }

      return filePath;
    } catch (error) {
      console.error('Beleg-Upload fehlgeschlagen', error);
      return null;
    }
  },

  async download(expenseId) {
    try {
      const { data, error } = await supabase.storage
        .from('receipts')
        .download(`${expenseId}.jpg`);

      if (error || !data) {
        console.error('Beleg laden fehlgeschlagen', error);
        return null;
      }

      return URL.createObjectURL(data);
    } catch (error) {
      console.error('Beleg laden fehlgeschlagen', error);
      return null;
    }
  },

  async delete(expenseId) {
    try {
      const { error } = await supabase.storage
        .from('receipts')
        .remove([`${expenseId}.jpg`]);

      if (error) {
        console.error('Beleg löschen fehlgeschlagen', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Beleg löschen fehlgeschlagen', error);
      return false;
    }
  },
};
