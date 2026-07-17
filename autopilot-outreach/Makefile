# Autopilot Outreach — dev shortcuts. Everything runs on stdlib Python 3.9+.
.PHONY: help demo dashboard test list summary reset

help:
	@echo "make demo       - run a full mock campaign end-to-end"
	@echo "make dashboard  - serve the local dashboard at http://localhost:8000"
	@echo "make test       - run the test suite"
	@echo "make list       - list all leads"
	@echo "make summary    - funnel counts + revenue"
	@echo "make reset      - wipe local data (db + generated demos/outbox)"

demo:
	python3 run.py demo

dashboard:
	python3 run.py dashboard

test:
	python3 -m unittest discover -s tests -v

list:
	python3 run.py list

summary:
	python3 run.py summary

reset:
	python3 run.py reset
