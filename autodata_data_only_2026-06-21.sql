SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict L58v8dlVZztQqun2Aq8cObkVy7j54A3hVkr7O0lZCnlSrhNMvFVB3TzkbQIv96Y

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."assets" ("id", "fingerprint_hash", "vin", "make", "model", "year", "trim", "exterior_color", "interior_color", "origin_status", "status", "historical_decay_timer_days", "first_seen_at", "last_seen_at", "created_at", "updated_at", "body_style", "cylinders", "engine_type", "transmission", "fuel", "drivetrain", "horsepower") VALUES
	('445a5466-ca91-4c8e-b22f-6ca38734351d', '6412bc0f090e025e3e6eb856af2d0b7ee22c060bea628906f43fc76878d81aac', '4T1BZ1HK9KU032057', 'Toyota', 'Camry XSE V6', 2019, 'XSE V6', 'White', NULL, 'Unknown', 'ACTIVE', NULL, '2026-05-06 15:25:39.193756+00', '2026-05-06 15:28:10.8891+00', '2026-05-06 15:25:39.193756+00', '2026-05-06 15:28:10.8891+00', 'Sedan', 6, '3.5L 6', 'Automatic', 'Gas', 'FRONT WHEEL DRIVE', 302);


--
-- Data for Name: research_runs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: sightings; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."sightings" ("id", "asset_id", "source_platform", "source_type", "source_url", "lot_number", "dealer_source", "dealer_tier", "listed_price", "listed_currency", "mileage_miles", "damage_type", "title_type", "location", "image_urls", "confidence_score", "raw_payload", "captured_at", "created_at", "estimated_retail_value_usd", "current_bid_usd", "seller", "sale_date", "has_key", "runs_and_drives", "engine_starts", "transmission_engages", "highlights", "secondary_damage", "odometer_brand", "estimated_cost_low_usd", "estimated_cost_high_usd", "seller_type", "source_auction_platform") VALUES
	('bc7bfa8c-16b4-42bd-a836-91b1b844fea8', '445a5466-ca91-4c8e-b22f-6ca38734351d', 'copart', 'research_capture', 'https://www.copart.com/lot/47821706/salvage-2019-toyota-camry-xse-v6-il-chicago-south', '47821706', NULL, NULL, NULL, 'USD', 27366, 'Hail', 'IL - Salvage Certificate', 'IL - CHICAGO SOUTH', '["https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/5546e595b89545988da3997800a0c570_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/cfe57cc2bada4d05a89a29fc553f1d10_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/a9df738368aa4dedb1aa8903a0c57e1c_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/58d241f5efdc4022976435a10cfdeb60_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/fd0ccd47771a458b8d0a65973e94eed2_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/5e5745c60ca8480e9b52881e95b7cfeb_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/c4a95d9c1c6c42f19166e625cb66af44_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/18cd3a3700244127bc4326e7b42985f5_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/1baf4b87d44f44d5bb2cb2592ba73e06_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/1470915b274548b582aedd94a094dcce_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/8bf40d516bfc4840bf2116039c8560da_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/7b8b1f6bee674f18991494c5abe0e0f4_ful.jpg"]', NULL, '{"image_urls": ["https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/5546e595b89545988da3997800a0c570_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/cfe57cc2bada4d05a89a29fc553f1d10_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/a9df738368aa4dedb1aa8903a0c57e1c_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/58d241f5efdc4022976435a10cfdeb60_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/fd0ccd47771a458b8d0a65973e94eed2_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/5e5745c60ca8480e9b52881e95b7cfeb_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/c4a95d9c1c6c42f19166e625cb66af44_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/18cd3a3700244127bc4326e7b42985f5_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/1baf4b87d44f44d5bb2cb2592ba73e06_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/1470915b274548b582aedd94a094dcce_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/8bf40d516bfc4840bf2116039c8560da_ful.jpg", "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0326/7b8b1f6bee674f18991494c5abe0e0f4_ful.jpg"], "source_url": "https://www.copart.com/lot/47821706/salvage-2019-toyota-camry-xse-v6-il-chicago-south", "captured_fields": {"vin": "4T1BZ1HK9KU032057", "fuel": "Gas", "make": "Toyota", "year": 2019, "model": "Camry XSE V6", "seller": null, "has_key": "Yes", "location": "IL - CHICAGO SOUTH", "cylinders": 6, "sale_date": "Wed. May 06, 2026 06:00 PM GMT+1", "body_style": "Sedan", "drivetrain": "FRONT WHEEL DRIVE", "highlights": "Run and Drive", "lot_number": "47821706", "title_type": "IL - Salvage Certificate", "damage_type": "Hail", "engine_type": "3.5L 6", "transmission": "Automatic", "engine_starts": true, "mileage_miles": 27366, "exterior_color": "White", "odometer_brand": "Actual", "current_bid_usd": 7900, "runs_and_drives": true, "secondary_damage": null, "transmission_engages": true, "estimated_retail_value_usd": 27339}, "source_platform": "copart", "raw_dom_snapshot": "Skip to main content\nSkip to footer\nMember portal\n\t\nSearch inventory\nUSA | English\nJAMILU DANMUSA\nDashboard\nDriver''s seat\nInventory \nAuctions \nBid status \nPayments \nLocations\nSell your car \nServices & support \nFeedback\nHelp center\nBack to results\nWatchlist\n5 of 679 results\n2019 TOYOTA CAMRY XSE V6\nRun and Drive\nVIN:4T1BZ1HK9KU032057\nLot number:47821706\nLane/Item:\n \nA/1\nSale name:\nIL - CHICAGO SOUTH\nLocation:\nIL - CHICAGO SOUTH\nSublot location:\n1010 EAST SAUK TRAIL, CHICAGO HEIGHTS, IL 60411\n1/14\nWatchlist\nEngine starts\nCopart verified that the engine starts.\nTransmission engages\nCopart verified that the transmission engages.\nOrder condition report\nTitle code:\nIL -\nSalvage Certificate \nOdometer:\n27,366 mi\nActual \nPrimary damage:\nHail\nEstimated retail value:\n$27,339.00USD\nCylinders:\n6\nColor:\nWhite\nHas key:\nYes\nEngine type:\n3.5L 6\nListen to engine\nTransmission:\nAutomatic\nVehicle type:\nAutomobile\nDrivetrain:\nFRONT WHEEL DRIVE\nFuel:\nGas\nBody style:\nSedan\nSale date:\nWed. May 06, 2026 06:00 PM GMT+1 \nHighlights:\nRun and Drive\nNotes:\nThere are no notes for this lot\nCurrent bid\n$7,900\nAuction countdown: 0D 1H 34min\nMinimum bid:Seller reserve not yet met \nMax bid\nMonster bid\n$\nBid now\nShipping estimate\nCheck estimate\nBidding increment\n$100\nEligibility\nCan''t bid\nCheck why?\nAll bids are legally binding and all sales are final.\nLearn more\nHome\nToyota\n2019 TOYOTA CAMRY XSE V6\nLast Updated:05/04/2026 11:31 pm\nEnglish\nUSA\n‌\n‌\n‌\n‌\nGet to Know Us\nAbout Copart\nOur History\nHow VB3 Works\nCommunity\nMember News\nCopart Reviews\nCareers\nPress Releases\nInvestor Relations\nFind a Vehicle\nVehicle Finder\nSales List\nSaved Searches\nVehicle Alerts\nAuctions\nToday''s Auctions\nAuctions Calendar\nJoin Auction\nNight Cap Sales\nBank-Repo Vehicles\nRental Auctions\nWholesale Auctions\nServices\nBrokers\nVehicle Reports\nIndustry Links\nShipping\nTow Providers\nInternational Buyers\nSupport\nHelp Center\nGlossary of Terms\nResource Center\nHelp With Licensing\nVideos\nMember Fees\nMember Mobile\nSeller Mobile\nNew Member Guide\nConnect with Us\nFacebook\nInstagram\nTikTok\nLinkedIn\nYouTube\nBlog\nDownload the App\nCopyright @ \n2026\n Copart Inc. All Rights Reserved\nSite Map\nContact Us\nSell a Vehicle\nTerms of Service\nPrivacy Policy\nCopyright\nTerms & Conditions\nCookie Policy\nYour Privacy Choices"}', '2026-05-06 15:25:39.354084+00', '2026-05-06 15:25:39.354084+00', 27339, 7900, NULL, 'Wed. May 06, 2026 06:00 PM GMT+1', 'Yes', true, true, true, 'Run and Drive', NULL, 'Actual', NULL, NULL, NULL, NULL),
	('1c6a0143-0975-45dd-abe1-37c1b613ab96', '445a5466-ca91-4c8e-b22f-6ca38734351d', 'bidcars', 'research_capture', 'https://bid.cars/en/lot/1-47821706/2019-Toyota-Camry-4T1BZ1HK9KU032057', '47821706', NULL, NULL, NULL, 'USD', 27366, 'Hail', 'Salvage certificate (IL)', 'Chicago South (IL)', '["https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-1.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-2.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-3.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-4.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-5.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-6.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-7.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-8.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-9.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-10.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-11.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-12.jpg"]', NULL, '{"image_urls": ["https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-1.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-2.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-3.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-4.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-5.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-6.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-7.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-8.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-9.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-10.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-11.jpg", "https://images.bid.cars/147821706_69f3a713701ef/2019-Toyota-Camry-4T1BZ1HK9KU032057-12.jpg"], "source_url": "https://bid.cars/en/lot/1-47821706/2019-Toyota-Camry-4T1BZ1HK9KU032057", "captured_fields": {"vin": "4T1BZ1HK9KU032057", "fuel": "Gasoline", "make": "Toyota", "trim": "XSE V6", "year": 2019, "model": "Camry", "has_key": "Yes", "location": "Chicago South (IL)", "cylinders": 6, "body_style": "Sedan", "drivetrain": null, "highlights": "Run and Drive", "horsepower": 302, "lot_number": "47821706", "title_type": "Salvage certificate (IL)", "damage_type": "Hail", "engine_type": "3.5L V6", "seller_type": "Insurance Company", "transmission": "Automatic", "mileage_miles": 27366, "exterior_color": "White", "current_bid_usd": 7900, "runs_and_drives": true, "secondary_damage": null, "estimated_cost_low_usd": 7880, "estimated_cost_high_usd": 12570, "source_auction_platform": "copart", "estimated_retail_value_usd": 27339}, "source_platform": "bidcars", "raw_dom_snapshot": "Current\n0\n$0/$0\nUmar farouk Bashir (322740)\nSearch & Bid\nDelivery Times\nHow it works\nHelp\nAbout Us\nContact\n  Follow us    \nEnglish\nYou cannot make any bids now. Click here to add deposit and unblock bidding ability.\nBidCars\nAutomobile\nToyota\nCamry\n8th gen XV70\n2019 Toyota Camry 4T1BZ1HK9KU032057\n11 people\nviewed this vehicle\n2019 TOYOTA CAMRY, XSE V6\n4T1BZ1HK9KU032057\nCopart\nLocation:\nChicago South (IL)\nShipping from:\nIndianapolis (IN)\nOdległość:\n~150 mil (241 km)\nEstimated cost:\n$7,880\n - \n$12,570\n \nEstimated delivery time (EU)\n4 August - 18 August\nWatch\nSales History\n0\nSimilar archival offers\nLive auction\nWednesday, 6 May, 18:00\nView 12 Photos\nSpin\nLot\n1-47821706 \nVIN\n4T1BZ1HK9KU032057 \nSeller\nInsurance Company\nSale Document\nSalvage certificate (IL)\nShow sale document\nPatryk Szwałek\nBidcars Expert\n\nRecommended by BidCars!\n\nHello, this vehicle is offered by the trusted Copart''s seller and has a Title recognized by the vehicle registration office in Poland. Enjoy bidding!\n\nLoss\n-\nPrimary damage\nHail\nSecondary damage\n-\nOdometer\n27 366 mi (44 041 km)\nStart code\nRun and Drive\nKey\nPresent\nACV / ERC\n$27,339 USD / $26,206 USD\nBody Style\nSedan\nExterior color\nWhite\nEngine\n3.5L, V6, 302HP\nTransmission\nAutomatic\nFuel Type\nGasoline\nShow more\n6\nVehicle Reports\nAvailable\n0\nNo credits\nNo credits\n Get Reports\nAdditional Services\n11\nVehicle with purchase restriction \n$0\n12\nHazardous cargo \n$0\n13\nOversized vehicle \n$0\n14\nOversized+ vehicle \n$0\nSelecting a check mark will add the given amount to the estimated total price.\nShow less\nCurrent Bid\n$7,900 USD\nYour max bid \n---\nTime left\n0 d 1 h 2 min 37 sec\nYour available bidding power has been exceeded.\nIncrease Bidding Power\nFinal Price Estimator\nPLN\nEUR\nEstimated\nCurrent Bid\n€12,755 - €18,209\n Estimated total price\n$7,880 - $12,570\n Purchase amount\n$10,415 - $15,235\n Customs value\n\nHave you noticed that the competition offers to import this vehicle for a price lower by several thousands of euro? It is worth asking about the customs value of the vehicle. Make sure what exactly is included in their offer. Savings on customs clearance costs may be offset by additional, hidden fees. The submission of a customs value declaration is the sole responsibility of the client. Always ask for a detailed cost calculation and do not rely solely on the home delivery price. Be aware and make an informed choice!\n\nEstimated\nFinal Price Calculator\n1 Lot Price\n$7,880 - $12,570\n2 Auction Fees \n$1,050 - $1,180\n3 Trucking to port\n$390\n4 Shipping to \nRotterdam, NL\nGdynia, PL\nBremerhaven, DE\nKlaipeda, LT\n$1,095\n5 BidCars Fee (+ VAT/Tax)\n$450\n1\n4\nSubtotal\n$10,415 - $15,235\nThe calculator check location of the vehicle and shipment from one of the six ports in the USA depending on the branch location.\nPenalties and additional auction fees\nEstimated\nCustoms Calculator\nEU Only \n1\n4\n Customs value\n6\nTax\n10% (Car)\n22% (Truck)\n6% (Motorcycle)\n1.7% (Jet Ski/Boat)\n0% (Classic Car)\n€885 - €1,295\n7\nVAT\n19% (Bremerhaven)\n21% (Rotterdam)\n23% (Gdynia)\n9% (Classic Car)\n€2,045 - €2,992\n8\nCustom agency “All In”\n€500\n6\n8\nCustom clearance total\n€3,431 - €4,787\n1\n8\nEstimated total price\n€12,755 - €18,209\nCustom clearance calculator is for information purposes only\n\nExchange rate: USD/EUR 0.8501, USD/PLN 3.6005, EUR/PLN 4.2351\nExchange rates updated: May 6, 2026, 5:00 PM\nRates of The National Bank of Poland nbp.pl\nFrequently Asked Questions\nHelp Center\nIs the process of purchasing vehicles from BidCars complicated?\n\nThe process of purchasing vehicles through the BidCars platform is characterized by its ease and clarity. It is essential to have basic website navigation skills, including tasks such as placing bids, depositing security, and conducting international transfers in US dollars (USD) and euros (EUR) through your bank. We handle all formalities for the client, from contact with the auction house, documentation management, arranging transportation in the United States, loading into the container, unloading, customs clearance, to vehicle delivery to the specified address.\n\nBidCars Vehicle Purchase Process\nHow to pay for the auctioned vehicle?\n\nTo finalize the payment for the auctioned vehicle, you need a currency account in USD and the ability to make international foreign transfers. If you have doubts about conducting the transaction on your own, you can print the email received from us along with the attached PDF file with transfer details and seek support at your local bank branch.\n\nWhat happens after winning a bid?\n\nAfter winning a bid on the BidCars platform, your bid status will change to ''Vehicle Won''. This means your offer has been accepted by the seller, and you have purchased the vehicle. The final amount you pay may be lower than your maximum offered sum, thanks to BidCars'' efforts to secure the car at the best price during live bidding. Within a few hours of the auction ending, you will receive an email with transaction details, including the account number, the exact amount to be paid, and the transfer title. Payments are made in USD, directing funds directly to the auction house, whether it''s Copart or IAAI.\n\nImport Schedule\nDoes BidCars handle customs clearance and home delivery?\n\nFor all vehicles directed to Rotterdam, our main port, we offer comprehensive logistics services. This includes customs clearance and the delivery of the vehicle directly to the client''s (for specific locations), ensuring the entire process of importing the car is comfortable and hassle-free for our clients.\n\n4 steps to purchasing a vehicle from the USA with BidCars\nHow it works\nSTEP 1\nFind your dream car\n\nFind your dream car from the USA. Our search engine and detailed filters will make it easy for you to browse through our car database. At BidCars, you don''t need to create an account to view the cars and auctions that interest you.\n\nYou only need to create an account when you want to participate in an auction. The registration and account activation process is straightforward and will take you no more than 5 minutes.\n\nCreate a free account\nSTEP 3\nThe auction starts right now – feel the thrill of the action!\n\nSet the maximum amount you''re willing to pay for a given vehicle. The calculator provided on the page will help you sum up all the costs. Your order will be accepted - the vehicle will be auctioned by BidCars during the live auction of the auction house.\n\nIn the case when the BidCars user''s offer is higher than the highest offer from the preliminary bidding in the auction house, the user is represented by our team during the live auction up to the maximum amount set by themselves - this way you ensure the highest effectiveness in the auction and the possibility of buying the vehicle at the lowest possible price.\n\nSTEP 2\nMake a Refundable Deposit\n\nA refundable deposit is required so you can participate in auctions – this is a requirement of the auction houses Copart and IAAI. We do not charge any fees for participating in auctions - if you wish to withdraw from cooperation, you can order a refund of the deposit from your customer panel.\n\nOnce the deposit is booked into our account, you will have the opportunity to place bids the same day. If you win the auction, the funds will be frozen until you pay for the vehicle. If you lose, the deposit will be automatically released. Use it to bid on another vehicle, or refund the funds to your bank account under the \"Deposit Refund\".\n\nSTEP 4\nPay for the vehicle and... wait for it to arrive!\n\nAfter the auction has been won by BidCars, you''ll receive bank transfer details and instructions for making an international transfer to the USA.\n\nOnce the funds are booked, we''ll pick up your vehicle and take additional photos.\n\nWe stay in touch with you throughout the entire process of importing the vehicle from the USA. You can check the status of your vehicle on our website, and in case of customs clearance at the port in Rotterdam, we''ll handle all the formalities.\n\nAll you need to do is wait for your new car to be delivered to your doorstep!\n\nCompare auctions\n2019 Toyota Camry, Xse V6\n4T1BZ1HK9KU032057\n0d 2h 1m 51s\nCurrent Bid\n$7,900\n2018 Toyota Camry, Hybrid SE\n4T1B21HK9JU509248\nFinished\nFinal bid\n$8,375.00\n2018 Toyota Camry, L\n4T1B11HK2JU014750\nFinished\nFinal bid\n$2,150.00\n2020 Toyota Camry, LE\n4T1C11AK1LU322266\nFinished\nFinal bid\n$4,200.00\n2018 Toyota Camry, LE\n4T1B11HK5JU129925\nFinished\nFinal bid\n$3,300.00\n2020 Toyota Camry, SE\n4T1M11BK6LU006963\nFinished\nFinal bid\n$4,100.00\n2019 Toyota Camry\n4T1B11HK2KU295269\nFinished\nFinal bid\n$5,800.00\n2018 Toyota Camry, L\n4T1B11HK5JU658890\nFinished\nFinal bid\n$6,800.00\n2020 Toyota Camry, SE\n4T1M11AK9LU868723\nFinished\nFinal bid\n$5,925.00\n2018 Toyota Camry, L\n4T1B11HK8JU629335\nFinished\nFinal bid\n$6,600.00\n2018 Toyota Camry\n4T1B61HK0JU105498\nFinished\nFinal bid\n$6,200.00\n2019 Toyota Camry, LE\n4T1B31HK7KU007417\nFinished\nFinal bid\n$4,450.00\nPopular models Toyota\n4runner\n86\nAvalon\nBZ4X\nC-HR\nCamry\nCelica\nCelsior\nChaser\nCorolla\nCorolla Cross\nCressida\nCrown\nEcho\nFJ Cruiser\nGR86\nGrand Highlander\nHiace\nHighlander\nHilux\nLand Cruiser\nMR2\nMatrix\nMirai\nOther\nPaseo\nPickup\nPrevia\nPrius\nRAV4\nScion\nSequoia\nSienna\nSoarer\nSupra\nT100\nTacoma\nTercel\nTundra\nUK\nVan\nVenza\nYaris\nDelivery & pickup options\n\nHome delivery from Rotterdam to your doorstep available in:\n\nPoland\nAustria\nBelgium\nCzech Republic\nDenmark\nGermany\nLuxemburg\nNetherlands\nSlovakia\n\nThe rest of EU in-person pickup from 5 locations:\n\nRotterdam, NL\nBremerhaven, DE\nGdynia, PL\nKlaipeda, LT\nBidcars, Poznań, PL (extra charge)\n 4,9\nBased on 42 reviews\n 4,9\nBased on 538 reviews\n 4,8\nBased on 77 reviews\n 5,0\nBased on 203 reviews\nFacebook\nInstagram\nLinkedIn\n\nWilczak 20B/40, 61-623 Poznań, Poland\nTax no.: 499-06-50-123\n\nCompany\nBlog\nAbout Us\nFor press\nContact Us\nSupport\nFAQ\nBefore purchase\nAfter purchase\nDelivery times\nSale documents\nTransport calculator\nKeywords\nIAAI\nCopart\nBidfax\nBidcar\nImport USA\nAuctions\nAll Auctions\n    - Opened\n    - Live\n    - Finished Today\n    - Fast Buy\nArchived\nAccount\nLogin\nRegistration\nPassword recovery\nTerms\nPrivacy and Cookies\n\nⒸ 2026 BidCars. All Rights Reserved\n\n(UTC+00:00) Edinburgh   English "}', '2026-05-06 15:28:10.8891+00', '2026-05-06 15:28:10.8891+00', 27339, 7900, NULL, NULL, 'Yes', true, NULL, NULL, 'Run and Drive', NULL, NULL, 7880, 12570, 'Insurance Company', 'copart');


--
-- Data for Name: research_run_listings; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: sales; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."sales" ("id", "make", "model", "trim", "year", "price", "originalCurrency", "priceUSD", "exchangeRate", "dateListed", "dateSold", "daysToSell", "dealer", "tags", "notes", "recordType", "mileage") VALUES
	('41974f2e-fca0-41d2-9b3f-ff3ab8d11bbe', 'Lexus', 'NX', 'NX350', '2024', 69999999, 'NGN', 50556.47805079641, 1384.5901, '2025-11-07', '2026-02-14', 99, 'abujacar LTD', '{}', NULL, 'INVENTORY', 4000),
	('7bdc82e4-7710-4ed9-8beb-edb755a464b0', 'Ferrari', 'Purosangue', 'Base', '2025', 1500000000, 'NGN', 1085899.044135267, 1381.343881, '2025-12-26', '2026-01-11', 16, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('6ee490ae-75af-4a1f-8251-f5fb2e9bd7c0', 'Hyundai', 'Sonata', 'Sport', '2015', 14999999, 'NGN', 11036.127657277983, 1359.172299, NULL, '2026-04-01', NULL, 'Abujacar', '{}', NULL, 'INVENTORY', 52000),
	('43da38a5-a0e9-4499-85b8-8eeedc3512dc', 'Mercedes-Benz', 'GLE', 'BRABUS 800', '2025', NULL, 'NGN', NULL, 1359.172299, NULL, '2026-04-17', NULL, 'Abujacar', '{}', NULL, 'INVENTORY', NULL),
	('d2cdf39c-95a4-459a-a74e-de100f3f4312', 'Mercedes-Benz', 'E-Class', 'E 63s AMG', '2022', 119999999, 'NGN', 86737.9404617255, 1383.477615, '2026-03-04', '2026-03-10', 6, 'Abujacar', '{}', NULL, 'MARKET_DATA', 11000),
	('7bca2400-8796-48c1-8e10-1eff91ac03c4', 'Lexus', 'LX', '600', '2025', 214999999, 'NGN', 155405.477232821, 1383.477615, '2026-02-13', '2026-02-17', 4, 'Abujacar', '{}', NULL, 'MARKET_DATA', 6000),
	('e1b0cf11-1d9b-489c-b5f3-08b24e22a2d1', 'Ferrari', 'Purosangue', 'Rosso Corsa', '2026', NULL, 'N', NULL, 1, '2026-02-21', '2026-02-14', 7, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('ac43dfde-0b07-4a02-b1f1-5aaa7b36b04b', 'BMW', '3 Series', '330i xDrive', '2026', 94999999, 'NGN', 68667.53604827932, 1383.477615, '2026-02-09', '2026-02-14', 5, 'Abujacar', '{}', NULL, 'MARKET_DATA', 2000),
	('db2d69a7-e67c-4a79-b302-28a05b3c8808', 'Toyota', 'Coaster', 'VIP', '2025', NULL, 'NGN', NULL, 1, '2026-02-12', '2026-02-14', 2, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('7fa2ddd9-3331-434f-94e7-66811d8840b5', 'Toyota', 'Camry', 'XSE', '2020', 29000000, 'NGN', 20961.669119597573, 1383.477615, '2025-11-20', '2026-02-14', 86, 'Abujacar', '{}', NULL, 'MARKET_DATA', 100000),
	('0424075b-c93a-4df8-b81b-464d2d967675', 'Mercedes-Benz', 'C-Class', 'C 43 AMG', '2024', 149999999, 'NGN', 108422.42575786092, 1383.477615, '2025-12-08', '2026-02-14', 68, 'Abujacar', '{}', NULL, 'MARKET_DATA', 2000),
	('a3707673-9aa3-4862-821c-96eb4eb15b31', 'BMW', '4 Series', '435i Convertible', '2014', NULL, 'NGN', NULL, 1383.477615, '2026-02-03', '2026-02-14', 11, 'Abujacar', '{}', NULL, 'MARKET_DATA', 21000),
	('fa9d430b-c1d5-4390-addd-7a16fba0a283', 'Lamborghini', 'Revuelto', 'Base', '2025', NULL, 'NGN', NULL, 1383.477615, '2026-01-10', '2026-02-14', 35, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('507b6755-36eb-41aa-9003-a7cc4d86d624', 'Lexus', 'LX', 'LX600 Signature', '2025', NULL, 'NGN', NULL, 1383.477615, '2026-01-27', '2026-02-09', 13, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('1df2cd78-4ac6-4558-ac61-61d3cef8a863', 'Land Rover', 'Range Rover', 'SV', '2023', NULL, 'NGN', NULL, 1383.477615, '2026-01-06', '2026-01-11', 5, 'Abujacar', '{}', NULL, 'MARKET_DATA', 3000),
	('2187fe35-3bbf-456a-9a93-d408e6e90e92', 'Mercedes-Benz', 'E-Class', 'E 63 AMG S', '2022', 124999999, 'NGN', 90352.02134441474, 1383.477615, '2026-01-05', '2026-01-11', 6, 'Abujacar', '{}', NULL, 'INVENTORY', 11000),
	('319f6982-78ef-46a9-8069-582c47df949d', 'Land Rover', 'Range Rover', 'Autobiography', '2024', NULL, 'NGN', NULL, 1383.477615, '2025-06-13', '2025-11-04', 144, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('b0eb0c52-25d2-4f7d-8526-a78d213d0958', 'Land Rover', 'Range Rover', 'Autobiography', '2023', 299999999, 'NGN', 216844.85223853803, 1383.477615, '2025-04-29', '2025-11-04', 189, 'Abujacar', '{}', NULL, 'MARKET_DATA', 16000),
	('ad7f7d85-3f7b-4f6b-be78-c675b2c8faf7', 'Mercedes-Benz', 'G-Class', 'G 63 AMG', '2025', 550000000, 'NGN', 397548.89709581604, 1383.477615, '2026-05-03', '2025-11-04', 180, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('103cfe08-0ef2-4c86-baca-f125a22f7174', 'BYD', 'Seagull', 'Base', '2024', 39999999, 'NGN', 28912.646338697716, 1383.477615, '2025-06-02', '2025-11-04', 155, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('ed7db7fc-9430-4ffe-93b8-d9ace8013d7c', 'Mercedes-Benz', 'G-Class', 'G 63 AMG', '2025', 570000000, 'NGN', 412005.22062657296, 1383.477615, '2026-04-29', '2025-11-04', 176, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('961abd61-f4dc-4583-9aaa-0e7e43ae0580', 'Mercedes-Benz', 'G-Class', 'G 63 AMG', '2025', NULL, 'NGN', NULL, 1383.477615, '2025-06-16', '2025-11-04', 141, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('7eb7b2b8-81e3-44e1-8afa-0a8e92ab823d', 'Mercedes-Benz', 'GLE', '350', '2022', NULL, 'NGN', NULL, 1383.477615, NULL, '2025-11-03', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('1d498da7-ac55-47d0-8787-38340023d7fe', 'Toyota', 'Land Cruiser', 'Base', '2023', NULL, 'NGN', NULL, 1383.477615, NULL, '2025-11-01', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('425ccdcd-3335-4c30-aa90-498386c244f0', 'Toyota', 'Hilux', 'GR', '2022', NULL, 'NGN', NULL, 1383.477615, NULL, '2025-11-01', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('8a186f29-f6b2-428a-8414-c6e0384dc75d', 'Toyota', 'Hilux', 'GR', '2022', NULL, 'NGN', NULL, 1383.477615, NULL, '2025-11-01', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('1a0bdff9-1155-489a-9bf2-4b4c514c75f0', 'Lamborghini', 'Urus', 'Mansory', '2023', 800000000, 'NGN', 578252.9412302779, 1383.477615, '2025-10-29', '2025-10-30', 1, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('e1c24ee3-49f5-4b82-8c91-987e8f01e8cd', 'Toyota', 'Land Cruiser', 'VX 3.5L Twin Turbo', '2025', 155000000, 'NGN', 112036.50736336634, 1383.477615, '2025-10-17', '2025-10-24', 7, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('241a3b97-d2ec-409b-8cd6-ab35af52b320', 'Toyota', 'Land Cruiser', 'VX', '2025', 239999999, 'NGN', 173475.8816462672, 1383.477615, '2025-10-17', '2025-10-21', 4, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('d476e6c2-7de1-4a0a-8711-49f361f024a9', 'Huawei', 'Avatr 11', '116 KWH BATTERY', '2025', 169999999, 'NGN', 122878.74928861787, 1383.477615, '2025-10-03', '2025-10-21', 18, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('4fd7384a-f1af-4dba-9a7f-0b3525e7fd34', 'Huawei', 'Avatr 11', 'Base', '2025', 169999999, 'NGN', 122878.74928861787, 1383.477615, '2025-10-03', '2025-10-21', 18, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('c5829dca-a56a-4514-93f7-ac9a75a306fe', 'Toyota', 'Corolla', 'LE', '2021', 26000000, 'NGN', 18793.22058998403, 1383.477615, '2025-10-08', '2025-10-12', 4, 'Abujacar', '{}', NULL, 'MARKET_DATA', 24000),
	('82042899-2599-427f-8f08-7e0904146a6a', 'BMW', '5 Series', '540i', '2018', 37000000, 'NGN', 26744.19853190035, 1383.477615, '2025-10-09', '2025-10-11', 2, 'Abujacar', '{}', NULL, 'MARKET_DATA', 24000),
	('028bd4e5-c29d-4559-8dce-04623b203f25', 'Mercedes-Benz', 'S-Class', 'S 500SEL', '1996', 14500000, 'NGN', 10480.834559798786, 1383.477615, '2025-10-02', '2025-10-04', 2, 'Abujacar', '{}', NULL, 'MARKET_DATA', 13000),
	('ce5861b8-3d80-4878-8977-ccbba375b780', 'Toyota', 'Camry', 'XSE', '2019', 32000000, 'NGN', 23130.117649211115, 1383.477615, '2025-10-01', '2025-10-03', 2, 'Abujacar', '{}', NULL, 'MARKET_DATA', 37000),
	('e581e190-8f58-476c-be9e-bbc53309f35d', 'Avatr', '06', 'Base', '2025', 189999999, 'NGN', 137335.07281937482, 1383.477615, '2025-09-20', '2025-10-03', 13, 'Abujacar', '{}', NULL, 'MARKET_DATA', 650),
	('885c9012-7dcc-48da-a26e-7e36646cabc0', 'Toyota', 'Prado', 'Base', '2024', 125000000, 'NGN', 90352.02206723092, 1383.477615, '2025-09-04', '2025-10-03', 29, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('e12210a7-5654-4976-b874-5c3606a31a10', 'Lexus', 'LX', 'LX600', '2025', 320000000, 'NGN', 231301.17649211115, 1383.477615, '2025-09-11', '2025-10-03', 22, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('1573d4e9-09fc-495e-a059-b463b4a355f0', 'Hyundai', 'Santa Fe', 'Base', '2021', 42000000, 'NGN', 30358.27941458959, 1383.477615, '2025-07-04', '2025-10-03', 91, 'Abujacar', '{}', NULL, 'MARKET_DATA', 42000),
	('daa05244-8b70-487c-b6c4-45f0ddcdf8b4', 'Lamborghini', 'Urus', 'Performante', '2024', NULL, 'NGN', NULL, 1383.477615, '2025-05-02', '2025-10-03', 154, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('360f0b47-e6bc-4616-a673-1d6c49885a4a', 'Audi', 'R8', 'Coupe RWD', '2022', NULL, 'NGN', NULL, 1359.172299, '2026-04-16', '2026-04-17', 1, 'Abujacar', '{}', NULL, 'INVENTORY', NULL),
	('1302952e-3a75-4d1b-9b98-dd0c1198c23f', 'Toyota', 'Landcruiser', 'GX.R Twin Turbo', '2025', 148000000, 'NGN', 106976.7941276014, 1383.477615, '2025-09-29', '2025-10-03', 4, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('7ed4c000-f71b-43e2-b148-7f57b801940d', 'Lamborghini', 'Urus', 'Base', '2021', 450000000, 'NGN', 325267.2794420313, 1383.477615, '2025-04-27', '2025-10-03', 159, 'Abujacar', '{}', NULL, 'MARKET_DATA', 22000),
	('53652268-95bd-48e1-af4f-703b477c7f82', 'Toyota', 'Avalon', 'XSE', '2018', 39000000, 'NGN', 28189.830884976047, 1383.477615, '2025-07-21', '2025-10-03', 74, 'Abujacar', '{}', NULL, 'MARKET_DATA', 23000),
	('55a41ca2-c200-461c-a339-652318e404d2', 'Lexus', 'RX 350', 'Base', '2022', 75000000, 'NGN', 54211.21324033855, 1383.477615, '2025-07-25', '2025-10-03', 70, 'Abujacar', '{}', NULL, 'MARKET_DATA', 11000),
	('43ae6670-672d-4f35-a3fb-d03838080f6f', 'Lamborghini', 'Urus', 'Base', '2020', 385000000, 'NGN', 278284.22796707123, 1383.477615, '2025-10-03', '2025-10-03', 0, 'Abujacar', '{}', NULL, 'MARKET_DATA', 15000),
	('354594c8-752f-410b-bf8a-bbab91b3ec34', 'Toyota', 'Land Cruiser Prado', 'VX', '2021', 69000000, 'NGN', 49874.31618111147, 1383.477615, '2025-09-27', '2025-10-03', 6, 'Abujacar', '{}', NULL, 'MARKET_DATA', 21000),
	('f58101d4-f30b-4419-ad47-148857405bfd', 'Mercedes-Benz', 'G-Class', 'G 63 AMG', '2025', 599999999, 'NGN', 433689.7051998922, 1383.477615, '2025-09-13', '2025-10-03', 20, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('e4d4267a-f06b-43c8-b1f1-ab64ec8d855a', 'Huawei', 'Avatr 11', 'Base', '2025', 179999999, 'NGN', 130106.91105399634, 1383.477615, '2025-09-24', '2025-10-03', 9, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('38d719e8-0642-46e0-a967-33ac0c72ff67', 'Toyota', 'Hilux', 'Adventure V6', '2025', 99999999, 'NGN', 72281.61693096855, 1383.477615, '2025-01-29', '2025-09-04', 218, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('a0f1d814-b8ad-46f7-87df-c4a98ee4abaa', 'Land Rover', 'Range Rover Sport', 'Base', '2024', 220000000, 'NGN', 159019.55883832643, 1383.477615, '2025-04-07', '2025-09-04', 150, 'Abujacar', '{}', NULL, 'MARKET_DATA', 8000),
	('94003cc5-7203-4790-a517-845202a24789', 'Toyota', 'Land Cruiser', 'Bulletproof', '2024', 235000000, 'NGN', 165482.21165795677, 1420.092212, '2025-08-06', '2025-09-04', 29, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1243),
	('351cb183-32ba-447f-b34c-39cbcd3b973b', 'Land Rover', 'Range Rover', 'Autobiography', '2023', 299999999, 'NGN', 216844.85223853803, 1383.477615, '2025-04-29', '2025-09-04', 128, 'Abujacar', '{}', NULL, 'MARKET_DATA', 16000),
	('83938acd-b1a6-4066-8617-99bcf8dff014', 'Mercedes-Benz', 'GLE', '350', '2020', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-09-02', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('4151f124-5b30-4f59-ae62-f9cff211f0de', 'Mercedes-Benz', 'A-Class', '220', '2019', 40000000, 'NGN', 28167.18496305647, 1420.092212, '2025-08-03', '2025-09-02', 30, 'Abujacar', '{}', NULL, 'MARKET_DATA', 39000),
	('6a90fa6f-c85f-4cb1-ae49-dbb33c386097', 'Toyota', 'Land Cruiser', 'VXR', '2025', NULL, 'NGN', NULL, 1420.092212, '2025-08-17', '2025-09-02', 16, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1243),
	('62a6ad7b-04f7-46ee-b728-fb8b5f935608', 'Mercedes-Benz', 'GLE', '350', '2016', 39999999, 'NGN', 28167.184258876845, 1420.092212, '2025-08-18', '2025-08-26', 8, 'Abujacar', '{}', NULL, 'MARKET_DATA', 75000),
	('8f3a761e-015d-4330-8d9e-523be94564f6', 'Land Rover', 'Range Rover', 'Autobiography', '2025', 350000000, 'NGN', 246462.8684267441, 1420.092212, '2025-04-28', '2025-08-23', 117, 'Abujacar', '{}', NULL, 'MARKET_DATA', 4000),
	('768f25ad-dba9-450d-b608-7a711bf4e06c', 'Hyundai', 'Palisade', 'Base', '2020', 48000000, 'NGN', 33800.62195566776, 1420.092212, '2025-08-04', '2025-08-22', 18, 'Abujacar', '{}', NULL, 'MARKET_DATA', 67000),
	('7f57d6dd-1725-41c3-88f5-9cdd96737e14', 'Mercedes-Benz', 'GLE', '350', '2023', 110000000, 'NGN', 77459.75864840529, 1420.092212, '2025-07-03', '2025-08-21', 49, 'Abujacar', '{}', NULL, 'MARKET_DATA', 14000),
	('71f6f5cb-00bb-4b4b-82ca-207d35fd3364', 'Toyota', 'Urban Cruiser', 'Base', '2024', 45000000, 'NGN', 31688.083083438527, 1420.092212, '2025-08-08', '2025-08-17', 9, 'Abujacar', '{}', NULL, 'MARKET_DATA', 5000),
	('7aff2f47-8e58-4915-b622-1a04c799c2a3', 'Mercedes-Benz', 'GLK', '350', '2014', 18999999, 'NGN', 13379.412153272198, 1420.092212, '2025-06-21', '2025-08-16', 56, 'Abujacar', '{}', NULL, 'MARKET_DATA', 118000),
	('467fb8cc-3679-434f-a17a-8949a2cb2d35', 'Mercedes-Benz', 'E-Class', '300', '2017', 35000000, 'NGN', 24646.28684267441, 1420.092212, '2025-08-14', '2025-08-15', 1, 'Unknown', '{}', NULL, 'MARKET_DATA', 55000),
	('3415e048-2ee4-4e8e-875e-a6659427df48', 'Honda', 'Civic', 'Base', '2024', 35000000, 'NGN', 24666.592278802113, 1418.923198, '2025-08-07', '2025-08-14', 7, 'Abujacar', '{}', NULL, 'MARKET_DATA', 6000),
	('578d5253-204e-400a-b776-7ed0383b97e3', 'Toyota', 'Corolla', 'LE', '2023', 23000000, 'NGN', 16196.13135375747, 1420.092212, '2025-08-06', '2025-08-10', 4, 'Abujacar', '{}', NULL, 'MARKET_DATA', 301),
	('c3e3f3d1-48f8-48a9-92a0-211dd4e0487e', 'BMW', 'X6', 'M Competition', '2025', NULL, 'NGN', NULL, 1420.092212, '2025-08-08', '2025-08-10', 2, 'Abujacar', '{}', NULL, 'MARKET_DATA', 15000),
	('81e6a132-846d-4f1f-92e4-1f596e620832', 'Toyota', 'Hilux', 'Adventure', '2025', 99000000, 'NGN', 69713.78278356476, 1420.092212, '2025-07-15', '2025-08-07', 23, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1243),
	('35cf0330-fa63-4fbc-be4f-e8811022b302', 'Mercedes-Benz', 'E-Class', '300', '2019', 40000000, 'NGN', 28167.18496305647, 1420.092212, '2025-07-24', '2025-08-07', 14, 'Abujacar', '{}', NULL, 'MARKET_DATA', 39000),
	('8dd4d87e-1dfd-4dee-ae60-51047a88b24b', 'Honda', 'Accord', 'Sport', '2021', 29000000, 'NGN', 20421.20909821594, 1420.092212, '2025-05-19', '2025-08-06', 79, 'Abujacar', '{}', NULL, 'MARKET_DATA', 76000),
	('9211fc9d-25b2-4f6b-95d1-5aef1ba3c496', 'Land Rover', 'Range Rover', 'Autobiography', '2023', 330000000, 'NGN', 232570.7272001342, 1418.923198, '2025-05-21', '2025-08-06', 77, 'Abujacar', '{}', NULL, 'MARKET_DATA', 22000),
	('96f8605c-d47e-4d67-9d6c-826a859eb2e4', 'Toyota', 'Camry', 'SE', '2016', 17000000, 'NGN', 11971.053609298999, 1420.092212, '2025-08-03', '2025-08-04', 1, 'Abujacar', '{}', NULL, 'MARKET_DATA', 51000),
	('1fc28278-eb40-47eb-bad3-bb50fe5e959d', 'Mercedes-Benz', 'C-Class', '300', '2013', 15000000, 'NGN', 10562.694361146176, 1420.092212, '2025-07-01', '2025-08-03', 33, 'Abujacar', '{}', NULL, 'MARKET_DATA', 186000),
	('2c42f551-082f-4d80-8ac4-b9883b8eb9e6', 'Toyota', 'Corolla', 'Base', '2024', 49999999, 'NGN', 35208.980499640966, 1420.092212, '2025-03-21', '2025-08-03', 135, 'Abujacar', '{}', NULL, 'MARKET_DATA', 60),
	('86e5d631-9869-484c-9616-0af7be16a2c8', 'Mercedes-Benz', 'G-Class', '63 AMG', '2025', NULL, 'NGN', NULL, 1420.092212, '2025-03-27', '2025-08-03', 129, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('afb19415-1cb9-4216-9fa0-8eee7eecb4e9', 'Mercedes-Benz', 'GLE', '53 AMG Coupe', '2020', 159999999, 'NGN', 112668.73914804625, 1420.092212, '2025-07-10', '2025-08-03', 24, 'Abujacar', '{}', NULL, 'MARKET_DATA', 65000),
	('1a7757ce-4b46-42cf-8178-1a4759ddfb19', 'Toyota', 'Camry', 'HEV', '2025', 84000000, 'NGN', 59151.08842241859, 1420.092212, '2025-06-17', '2025-08-03', 47, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('8653a22d-efbc-488e-a921-8337dbf0622a', 'Toyota', 'Corolla', 'Base', '2022', 65000000, 'NGN', 45771.67556496676, 1420.092212, NULL, '2025-08-03', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('c51221d2-7b55-4ce2-ae11-91c2699505d4', 'Land Rover', 'Range Rover Velar', 'Base', '2017', 59000000, 'NGN', 41546.597820508294, 1420.092212, '2025-07-03', '2025-08-03', 31, 'Abujacar', '{}', NULL, 'MARKET_DATA', 100000),
	('f8469293-e92b-48ea-bb5e-989eabc21643', 'Lexus', 'GX', '550', '2025', 205000000, 'NGN', 144356.82293566442, 1420.092212, '2025-06-26', '2025-08-03', 38, 'Abujacar', '{}', NULL, 'MARKET_DATA', 2247),
	('1059de9e-668b-4572-80ff-99608cd211d3', 'Toyota', 'Prado', 'Base', '2025', 125000000, 'NGN', 88022.45300955146, 1420.092212, '2025-06-19', '2025-08-03', 45, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('614690b0-5bd6-44c6-85af-81cf68ec56ea', 'Mercedes-Benz', 'G-Class', '63 AMG', '2023', 350000000, 'NGN', 246665.92278802113, 1418.923198, '2025-06-27', '2025-08-03', 37, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('61476eea-42e2-426c-9741-42c821d0f2f0', 'Toyota', 'Camry', 'SE', '2023', 45000000, 'NGN', 31688.083083438527, 1420.092212, '2025-07-15', '2025-08-03', 19, 'Abujacar', '{}', NULL, 'MARKET_DATA', 29000),
	('c8a82b97-37c9-4b17-aff1-9ac2b09292e1', 'Mercedes-Benz', 'GLE', '450', '2020', 99999999, 'NGN', 70417.96170346155, 1420.092212, '2025-05-26', '2025-08-03', 69, 'Abujacar', '{}', NULL, 'MARKET_DATA', 8000),
	('9901d68f-d8e4-4899-a624-3d5ce876341c', 'Toyota', 'Camry', 'SE', '2018', 29000000, 'NGN', 20421.20909821594, 1420.092212, '2025-05-21', '2025-08-03', 74, 'Abujacar', '{}', NULL, 'MARKET_DATA', 15000),
	('a22faeb6-0f7a-4448-b006-e561c37e98fb', 'Mercedes-Benz', 'GLE', '450', '2021', 99999999, 'NGN', 70417.96170346155, 1420.092212, '2025-06-02', '2025-08-03', 62, 'Abujacar', '{}', NULL, 'MARKET_DATA', 12000),
	('0a872cc3-d4fb-43fe-b912-b53667615849', 'Mercedes-Benz', 'C-Class', '300', '2022', 105000000, 'NGN', 73938.86052802323, 1420.092212, NULL, '2025-08-03', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', 15000),
	('f6207a4e-65f1-459e-9b8c-3bafae53ff0e', 'Toyota', 'Corolla', 'Base', '2024', 49999999, 'NGN', 35208.980499640966, 1420.092212, '2025-03-21', '2025-08-03', 135, 'Abujacar', '{}', NULL, 'MARKET_DATA', 60),
	('2ffae7b0-3ddd-41fc-8a24-96fad15bfb5b', 'Toyota', 'Corolla', 'Base', '2024', 49999999, 'NGN', 35208.980499640966, 1420.092212, '2025-03-21', '2025-08-03', 135, 'Abujacar', '{}', NULL, 'MARKET_DATA', 60),
	('d3bbc99e-8701-49e4-b410-362ccba6e728', 'Toyota', 'Corolla', 'Base', '2024', 49999999, 'NGN', 35208.980499640966, 1420.092212, '2025-03-21', '2025-08-03', 135, 'Abujacar', '{}', NULL, 'MARKET_DATA', 60),
	('22c58218-a7a6-4fff-9bd2-d88e1b21bad2', 'Toyota', 'Corolla', 'Base', '2024', 49999999, 'NGN', 35208.980499640966, 1420.092212, '2025-03-21', '2025-08-03', 135, 'Abujacar', '{}', NULL, 'MARKET_DATA', 60),
	('183f01d7-b03c-4d7c-98e2-de7b7851fd1a', 'Toyota', 'Corolla', 'Base', '2024', 49999999, 'NGN', 35208.980499640966, 1420.092212, '2025-03-21', '2025-08-03', 135, 'Abujacar', '{}', NULL, 'MARKET_DATA', 60),
	('d9d744d8-ae47-41f4-b703-e78b57536289', 'Toyota', 'Land Cruiser', 'VXR', '2023', 157000000, 'NGN', 110556.20097999665, 1420.092212, '2025-03-03', '2025-08-03', 153, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('92d6231a-c5b1-4c89-b39c-6529c7d49786', 'Toyota', 'Hilux', 'Adventure', '2025', 99000000, 'NGN', 69713.78278356476, 1420.092212, NULL, '2025-08-03', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', 772),
	('a27d2f64-4085-44b3-b59c-4dd689b9028f', 'Toyota', 'Hilux', 'Adventure', '2025', 99000000, 'NGN', 69713.78278356476, 1420.092212, '2025-06-15', '2025-08-03', 49, 'Abujacar', '{}', NULL, 'MARKET_DATA', 772),
	('4e41b2ad-0234-4d36-9c93-cedacdbd4b2e', 'Chevrolet', 'Camaro', 'Base', '2014', 16500000, 'NGN', 11618.963797260794, 1420.092212, '2025-07-10', '2025-08-03', 24, 'Abujacar', '{}', NULL, 'MARKET_DATA', 50000),
	('c02381cc-2120-4561-9340-c1b410ce95d8', 'Toyota', 'Land Cruiser', 'VXR', '2025', 169000000, 'NGN', 119006.35646891358, 1420.092212, '2025-07-08', '2025-08-03', 26, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('f100b29b-c591-476c-bea3-d787482138e4', 'Toyota', 'Land Cruiser', 'VXR', '2025', 169000000, 'NGN', 119006.35646891358, 1420.092212, '2025-07-08', '2025-08-03', 26, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('ccfcb903-a4a7-49d6-9454-c909c1440fe7', 'Toyota', 'Land Cruiser', 'VXR', '2025', 155000000, 'NGN', 109147.84173184382, 1420.092212, '2025-07-08', '2025-08-03', 26, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('b4f57a0f-e7af-43f2-bbb0-1dc223533239', 'Toyota', 'Land Cruiser', 'VXR', '2025', 155000000, 'NGN', 109147.84173184382, 1420.092212, '2025-07-08', '2025-08-03', 26, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('3a63951a-8958-4223-9e41-d42c128d061c', 'Toyota', 'Camry', 'HEV', '2025', 85000000, 'NGN', 59855.268046494995, 1420.092212, '2026-05-24', '2025-08-03', 294, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('15fc8e74-dd82-4728-ba29-09e905ef0c46', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('0f7b17a9-6dcf-4e58-9a02-ec39512ad207', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('79f17cdc-8e27-4e58-9a03-88ef6a8a3d5d', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('8627050f-7f50-408c-9e0d-7b38d765a552', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('177da052-e51e-412f-9598-cc5ca1b39f70', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('d22c3834-9865-48bd-8d21-329b1d106746', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('1833bc59-ba77-4a7b-bcb1-67a9e2862204', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('5340101e-c920-49c1-8932-3a86c2696440', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('b102a6f5-36cf-489e-aea9-3bd036c7ad70', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('b84e37cf-c604-43f3-871b-571ca5402236', 'Toyota', 'Hilux', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-19', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('07832c8e-f780-4c74-a2f6-5c9d7dd810d8', 'Toyota', 'Hilux', 'GR Sport', '2024', 115000000, 'NGN', 80980.65676878735, 1420.092212, '2025-06-23', '2025-07-12', 19, 'Abujacar', '{}', NULL, 'MARKET_DATA', 414),
	('b82077c6-b8c2-47c6-ba33-e8fac903cb49', 'Toyota', 'Land Cruiser Prado', 'Base', '2025', 129999999, 'NGN', 93966.10222710398, 1383.477615, '2026-03-02', '2026-03-18', 16, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('42bb78d9-c520-4fdd-b077-e6b72dbdc1ef', 'Toyota', 'Land Cruiser Prado', 'Base', '2025', 114999999, 'NGN', 83123.85957903627, 1383.477615, '2026-02-26', '2026-03-18', 20, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('d4bc1c97-1728-4a75-9c76-ca1d16843f3c', 'Toyota', 'Land Cruiser Prado', 'Base', '2025', 129999999, 'NGN', 93966.10222710398, 1383.477615, '2026-03-01', '2026-03-18', 17, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('29215226-4991-4f02-823c-79ab47f5fe23', 'Toyota', 'Land Cruiser Prado', 'Base', '2025', 129999999, 'NGN', 93966.10222710398, 1383.477615, '2026-02-14', '2026-03-12', 26, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('89184af9-8c2c-481b-bab9-3f604a4165dd', 'Land Rover', 'Range Rover Velar', 'R-Dynamic SE', '2018', 64999999, 'NGN', 46983.0507521439, 1383.477615, '2026-02-14', '2026-03-12', 26, 'Abujacar', '{}', NULL, 'MARKET_DATA', 108000),
	('d3a52c2b-15aa-4881-ba12-ef2d1068007b', 'Mercedes-Benz', 'GLE', '53 AMG Coupe', '2022', 165000000, 'NGN', 116189.63797260793, 1420.092212, '2025-05-12', '2025-07-12', 61, 'Abujacar', '{}', NULL, 'MARKET_DATA', 40000),
	('295f9f5b-371d-4104-8fbe-b513709a87ec', 'Toyota', 'Land Cruiser', '250 VXR', '2025', 155000000, 'NGN', 109147.84173184382, 1420.092212, '2025-07-08', '2025-07-12', 4, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1287),
	('abd13030-c834-401b-9441-5ec4f4b94cff', 'Lexus', 'LX', '600 Bulletproof', '2025', NULL, 'NGN', NULL, 1420.092212, '2025-07-05', '2025-07-12', 7, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('96ecafcd-3fab-439e-9773-ddbf82540040', 'Toyota', 'Camry', 'XSE', '2019', 38000000, 'NGN', 26758.825714903647, 1420.092212, '2025-04-18', '2025-07-08', 81, 'Abujacar', '{}', NULL, 'MARKET_DATA', 163398),
	('fe4f9cc4-beec-433e-860c-3dc3ea664168', 'Lexus', 'LX', '600 Bulletproof', '2025', NULL, 'NGN', NULL, 1420.092212, '2025-07-01', '2025-07-04', 3, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1260),
	('47c7db47-93f9-4900-8e9f-0739cd0c733a', 'Lexus', 'LX', '600 Bulletproof', '2024', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-07-04', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', 2000),
	('fd98ed33-025e-449e-92ae-71c86f8d1feb', 'Mercedes-Benz', 'GLE', '350', '2020', 77000000, 'NGN', 54221.8310538837, 1420.092212, '2025-06-30', '2025-07-04', 4, 'Abujacar', '{}', NULL, 'MARKET_DATA', 25000),
	('bd80c497-bcf0-44bd-8746-d697d58c5604', 'Mercedes-Benz', 'GLE', '53 AMG Coupe', '2022', 168000000, 'NGN', 118302.17684483717, 1420.092212, '2025-04-30', '2025-07-04', 65, 'Abujacar', '{}', NULL, 'MARKET_DATA', 42000),
	('4c50ba65-1a84-4a30-ae74-5c985eea7c9d', 'Cadillac', 'Escalade', '600', '2022', 185000000, 'NGN', 130273.23045413617, 1420.092212, '2025-06-24', '2025-07-04', 10, 'Abujacar', '{}', NULL, 'MARKET_DATA', 12000),
	('f4382af8-4ad1-440b-b361-4b10911a19b3', 'Toyota', 'Camry', 'SE', '2018', 28000000, 'NGN', 19717.02947413953, 1420.092212, '2025-06-21', '2025-06-24', 3, 'Abujacar', '{}', NULL, 'MARKET_DATA', 92000),
	('6d4bd9fa-b453-48d4-bb36-e0137f487a70', 'Lexus', 'IS', '250', '2015', 19000000, 'NGN', 13379.412857451824, 1420.092212, '2025-06-02', '2025-06-17', 15, 'Abujacar', '{}', NULL, 'MARKET_DATA', 52000),
	('972bd837-66a9-4ec7-bb81-e15f4db4b932', 'BMW', '5 Series', 'M5', '2025', NULL, 'NGN', NULL, 1420.092212, '2025-07-06', '2025-06-12', 24, 'Abujacar', '{}', NULL, 'MARKET_DATA', 9000),
	('b7ef16ca-13de-4236-9760-1735b1cdce53', 'Lexus', 'RX', '350', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-06-02', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('bed130f8-f573-4230-a07f-499376892f06', 'Toyota', 'Camry', 'HEV', '2025', 88000000, 'NGN', 61967.80691872423, 1420.092212, '2025-02-11', '2025-03-07', 24, 'Abujacar', '{}', NULL, 'MARKET_DATA', 2000),
	('453b2b5b-5ec6-4ed9-841f-4752b649bd98', 'Toyota', 'Land Cruiser', '250 VXR', '2024', NULL, 'NGN', NULL, 1420.092212, '2025-03-05', '2025-03-06', 1, 'Abujacar', '{}', NULL, 'MARKET_DATA', 2000),
	('21fb6fc5-e90e-474c-ae72-46dc2456062f', 'Lamborghini', 'Urus', 'S', '2023', NULL, 'NGN', NULL, 1420.092212, '2025-01-12', '2025-03-05', 52, 'Abujacar', '{}', NULL, 'MARKET_DATA', 12000),
	('3d194253-3a16-4a0a-aa26-88c840a4afa5', 'Hyundai', 'Elantra', 'Base', '2015', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-03-05', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('85258d08-e8ce-432f-a4cb-2d5d37504793', 'Toyota', 'Prado', 'VX', '2023', 85000000, 'NGN', 59855.268046494995, 1420.092212, '2025-03-03', '2025-03-04', 1, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('3b2b8b9a-c745-4c3e-b761-8b6c35c63257', 'Toyota', 'Coaster', 'Base', '2014', NULL, 'NGN', NULL, 1420.092212, '2025-03-01', '2025-03-03', 2, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('7e95d12d-55e2-42cd-9055-0460d2ae7ab5', 'Mercedes-Benz', 'G-Class', '63 AMG', '2021', 350000000, 'NGN', 246462.8684267441, 1420.092212, '2025-01-10', '2025-03-01', 50, 'Abujacar', '{}', NULL, 'MARKET_DATA', 11000),
	('cf5ad591-d4fe-4a93-bf18-b511b61bc88f', 'Mercedes-Benz', 'C-Class', '300', '2023', 99999999, 'NGN', 70417.96170346155, 1420.092212, '2025-02-23', '2025-02-28', 5, 'Abujacar', '{}', NULL, 'MARKET_DATA', 7000),
	('e158f327-9adf-487b-905d-c135cd2ac897', 'Lamborghini', 'Urus', 'Base', '2020', NULL, 'NGN', NULL, 1420.092212, '2025-02-01', '2025-02-28', 27, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('3b2e482f-0131-4470-9b6f-b23e567af736', 'Mercedes-Benz', 'GLE', '350', '2021', 87000000, 'NGN', 61263.62729464782, 1420.092212, '2025-02-28', '2025-02-28', 0, 'Abujacar', '{}', NULL, 'MARKET_DATA', 86000),
	('33ecd5ed-4046-4f47-9c8b-f675c29306c8', 'Toyota', 'Prado', 'Base', '2024', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-02-26', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('0706aa49-637a-4393-84ad-bbd6f18fd524', 'Lexus', 'LX', '600', '2024', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-02-20', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('62b0f482-d33e-4786-9ef0-a2e3fec18155', 'Mercedes-Benz', 'AMG GT', '53 AMG', '2020', 115000000, 'NGN', 80980.65676878735, 1420.092212, '2025-02-17', '2025-02-20', 3, 'Abujacar', '{}', NULL, 'MARKET_DATA', 33000),
	('2557eea8-8f7d-48d4-960c-e93706036986', 'Mercedes-Benz', 'GLE', '450', '2020', 95000000, 'NGN', 66897.06428725911, 1420.092212, '2025-01-08', '2025-02-20', 43, 'Abujacar', '{}', NULL, 'MARKET_DATA', 70000),
	('c93b512b-69fa-4abc-aaf4-bb73a27f0da5', 'Toyota', 'Hilux', 'Adventure', '2025', 99999999, 'NGN', 70417.96170346155, 1420.092212, '2025-01-25', '2025-02-20', 26, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('2ddf9815-faaf-4927-95b6-3d8ff60efd16', 'Rolls-Royce', 'Cullinan', 'Black Badge', '2023', 1000000000, 'NGN', 704179.6240764117, 1420.092212, '2025-02-03', '2025-02-14', 11, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('5d3d39fd-1787-47bb-a419-5426a0223954', 'Lexus', 'GX', '550', '2025', 235000000, 'NGN', 165482.21165795677, 1420.092212, '2025-01-22', '2025-02-12', 21, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('b972c223-1b9e-4117-8c86-6a3386d7a0fa', 'Toyota', 'Land Cruiser', '250', '2025', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-02-08', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('5530a1bd-fa95-40e2-b275-8d4b34661c19', 'BMW', 'X5', 'M60i', '2024', NULL, 'NGN', NULL, 1420.092212, '2025-01-25', '2025-02-06', 12, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('5bc04118-0b9e-47ec-951c-350148aaccc8', 'Mercedes-Benz', 'S-Class', 'S 580', '2022', 250000000, 'NGN', 176044.90601910293, 1420.092212, '2025-01-10', '2025-01-30', 20, 'Abujacar', '{}', NULL, 'MARKET_DATA', 4000),
	('157842a8-bf68-4ecd-8d4e-c8acb4fe01ea', 'Land Rover', 'Range Rover', 'Vogue', '2023', 349000000, 'NGN', 245758.6888026677, 1420.092212, '2025-01-11', '2025-01-30', 19, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('de425a36-bfb8-469d-825b-240ac55ec067', 'Audi', 'A5', 'Base', '2023', 65000000, 'NGN', 45771.67556496676, 1420.092212, '2024-06-04', '2025-01-29', 239, 'Abujacar', '{}', NULL, 'MARKET_DATA', 1000),
	('c461ebdb-7186-436d-bf44-73d2fe8de498', 'Mercedes-Benz', 'C-Class', 'C 400', '2015', 27500000, 'NGN', 19364.939662101322, 1420.092212, '2025-01-28', '2025-01-28', 0, 'Abujacar', '{}', NULL, 'MARKET_DATA', 61000),
	('13c3918d-ec4e-4b4a-8b01-301124b40934', 'Toyota', 'Fortuner', 'VXR', '2022', 47000000, 'NGN', 33096.44233159135, 1420.092212, '2025-01-04', '2025-01-25', 21, 'Abujacar', '{}', NULL, 'MARKET_DATA', 23000),
	('55bb7f5e-1fbb-46c0-a4e2-bd3c1b8346f3', 'Hyundai', 'Elantra', 'Base', '2012', 12000000, 'NGN', 8450.15548891694, 1420.092212, '2025-01-15', '2025-01-25', 10, 'Abujacar', '{}', NULL, 'MARKET_DATA', 129000),
	('e51e9f8e-373e-4e97-bf21-7d5942c03dba', 'Toyota', 'Camry', 'Sport S', '2025', NULL, 'NGN', NULL, 1420.092212, '2024-12-30', '2025-01-24', 25, 'Abujacar', '{}', NULL, 'MARKET_DATA', 769),
	('9c0339ab-9181-4641-bbe3-665f503438ec', 'Mercedes-Benz', 'GLA', 'GLA 250', '2016', 19500000, 'NGN', 13731.502669490028, 1420.092212, '2025-01-15', '2025-01-24', 9, 'Abujacar', '{}', NULL, 'MARKET_DATA', 20505),
	('567a853d-1791-4010-bf96-2cea4c406abb', 'Mercedes-Benz', 'GLE', '53 AMG Coupe', '2021', 170000000, 'NGN', 119710.53609298999, 1420.092212, '2025-01-18', '2025-01-24', 6, 'Abujacar', '{}', NULL, 'MARKET_DATA', 10000),
	('bb084f01-1667-41ba-b781-fcab5e83fdb9', 'Mercedes-Benz', 'S-Class', 'S 580', '2023', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-01-14', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('01b48ce3-bd68-414e-8ea0-5a3f93c72720', 'Toyota', 'Camry', 'TRD', '2019', 23000000, 'NGN', 16196.13135375747, 1420.092212, '2024-12-20', '2025-01-10', 21, 'Abujacar', '{}', NULL, 'MARKET_DATA', 99000),
	('54b3f9de-8ca8-45ed-891a-b98aa1b99618', 'Mercedes-Benz', 'E-Class', 'E 450', '2021', 65000000, 'NGN', 45771.67556496676, 1420.092212, '2024-12-19', '2025-01-09', 21, 'Abujacar', '{}', NULL, 'MARKET_DATA', 42000),
	('4e199114-f587-4384-9840-6b9d1f272e0a', 'Mercedes-Benz', 'C-Class', 'C 300', '2021', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-01-08', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('09848c4c-b514-4db7-a37b-2f652aabf24d', 'Mercedes-Benz', 'C-Class', 'C 300', '2021', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-01-08', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('cb039034-4829-44df-9501-dfb1c35c0c07', 'Mercedes-Benz', 'GLC', 'GLC 300', '2021', NULL, 'NGN', NULL, 1420.092212, '2025-01-06', '2025-01-07', 1, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('2473c88e-4959-40d4-8237-dfd0551c9525', 'Mercedes-Benz', 'C-Class', 'C 300', '2024', 99999999, 'NGN', 70417.96170346155, 1420.092212, '2025-01-07', '2025-01-07', 0, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('037befd4-d7d3-4477-bd28-079b4ff376b3', 'Toyota', 'Land Cruiser', 'Base', '2022', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-01-06', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL),
	('49d30d47-7fcf-4799-b76d-e16cb82ee9a4', 'Land Rover', 'Range Rover', 'Vogue', '2024', NULL, 'NGN', NULL, 1420.092212, NULL, '2025-01-02', NULL, 'Abujacar', '{}', NULL, 'MARKET_DATA', NULL);


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict L58v8dlVZztQqun2Aq8cObkVy7j54A3hVkr7O0lZCnlSrhNMvFVB3TzkbQIv96Y

RESET ALL;
