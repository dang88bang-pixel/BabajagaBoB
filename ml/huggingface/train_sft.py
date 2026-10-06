"""Reproduzierbares LoRA-SFT für BabajagaBoB."""

from __future__ import annotations

import os
from pathlib import Path

from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoTokenizer
from trl import SFTConfig, SFTTrainer

ROOT = Path(__file__).resolve().parent
MODEL_ID = os.getenv('MODEL_ID', 'Qwen/Qwen3-0.6B')
OUTPUT_DIR = os.getenv('OUTPUT_DIR', str(ROOT / 'output'))
MAX_STEPS = int(os.getenv('MAX_STEPS', '0'))
ASSISTANT_ONLY_LOSS = os.getenv('ASSISTANT_ONLY_LOSS', '1') == '1'

dataset = load_dataset('json', data_files=str(ROOT / 'dataset.jsonl'), split='train')
split = dataset.train_test_split(test_size=0.2, seed=42)

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

lora = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    bias='none',
    task_type='CAUSAL_LM',
    target_modules='all-linear',
)

kwargs = dict(
    output_dir=OUTPUT_DIR,
    num_train_epochs=3,
    per_device_train_batch_size=1,
    per_device_eval_batch_size=1,
    gradient_accumulation_steps=8,
    learning_rate=1e-4,
    logging_steps=1,
    eval_strategy='steps',
    eval_steps=10,
    save_strategy='steps',
    save_steps=10,
    save_total_limit=2,
    report_to='none',
    bf16=os.getenv('BF16', '0') == '1',
    fp16=os.getenv('FP16', '0') == '1',
    packing=True,
    assistant_only_loss=ASSISTANT_ONLY_LOSS,
)
if MAX_STEPS > 0:
    kwargs['max_steps'] = MAX_STEPS

trainer = SFTTrainer(
    model=MODEL_ID,
    args=SFTConfig(**kwargs),
    train_dataset=split['train'],
    eval_dataset=split['test'],
    processing_class=tokenizer,
    peft_config=lora,
)

trainer.train()
trainer.save_model(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)
print(f'Training abgeschlossen: {OUTPUT_DIR}')
